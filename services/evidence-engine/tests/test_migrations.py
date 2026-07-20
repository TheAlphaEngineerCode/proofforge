"""Detecting migrations, and refusing to call one reversible without evidence."""

from pathlib import Path

import pytest

from proofforge_evidence.collectors import migrations


def write(repo: Path, relative: str, text: str) -> None:
    path = repo / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class TestRecognisingMigrationFiles:
    @pytest.mark.parametrize(
        "path",
        [
            "migrations/001_add_users.sql",
            "db/migrate/20260720_add_index.rb",
            "alembic/versions/ab12_add_column.py",
            "prisma/migrations/20260720_init/migration.sql",
            "supabase/migrations/0001_init.sql",
            "drizzle/0000_fine_morbius.sql",
            "sql/V2__add_orders.sql",
        ],
    )
    def test_recognises_the_common_layouts(self, path: str) -> None:
        assert migrations.is_migration_path(path)

    @pytest.mark.parametrize(
        "path",
        ["src/app.py", "docs/migrations.md", "tests/test_migration_helper.py"],
    )
    def test_leaves_ordinary_files_alone(self, path: str) -> None:
        assert not migrations.is_migration_path(path)

    def test_handles_windows_separators(self) -> None:
        assert migrations.is_migration_path("migrations\\001_init.sql")


class TestJudgingReversibility:
    def test_a_change_with_no_migrations_is_not_a_migration(self, tmp_path: Path) -> None:
        found = migrations.inspect(tmp_path, ["src/app.py"])

        assert found.detected is False
        # Reversible because there is nothing to reverse, and the detail says so
        # rather than leaving a bare true to be read as a judgement.
        assert "no migration files" in found.detail

    def test_an_additive_migration_is_reversible(self, tmp_path: Path) -> None:
        write(tmp_path, "migrations/001_add.sql", "CREATE TABLE orders (id serial primary key);")

        found = migrations.inspect(tmp_path, ["migrations/001_add.sql"])

        # Adding a table can be undone by dropping it; nothing was destroyed.
        assert found.detected is True
        assert found.reversible is True

    def test_a_drop_without_a_down_migration_is_not_reversible(self, tmp_path: Path) -> None:
        write(tmp_path, "migrations/002_drop.sql", "ALTER TABLE users DROP COLUMN email;")

        found = migrations.inspect(tmp_path, ["migrations/002_drop.sql"])

        # The data in that column is not in the file, so nothing here can restore it.
        assert found.reversible is False
        assert found.rollback_available is False
        assert "DROP COLUMN" in found.destructive_statements

    def test_a_drop_with_a_down_migration_is_reversible(self, tmp_path: Path) -> None:
        write(
            tmp_path,
            "migrations/003_drop.sql",
            "-- +migrate Up\nDROP TABLE sessions;\n"
            "-- +migrate Down\nCREATE TABLE sessions (id int);",
        )

        found = migrations.inspect(tmp_path, ["migrations/003_drop.sql"])

        assert found.reversible is True
        assert found.rollback_available is True

    @pytest.mark.parametrize(
        "text",
        [
            "def downgrade():\n    op.drop_column('users', 'email')",
            "exports.down = async () => {};",
            "-- +goose Down\nCREATE TABLE x (id int);",
        ],
    )
    def test_recognises_a_down_migration_in_each_dialect(self, tmp_path: Path, text: str) -> None:
        write(tmp_path, "migrations/004.py", f"DROP TABLE x;\n{text}")

        assert migrations.inspect(tmp_path, ["migrations/004.py"]).rollback_available is True

    def test_truncate_counts_as_destructive(self, tmp_path: Path) -> None:
        write(tmp_path, "migrations/005.sql", "TRUNCATE audit_log;")

        assert migrations.inspect(tmp_path, ["migrations/005.sql"]).reversible is False

    def test_a_delete_without_a_where_clause_counts(self, tmp_path: Path) -> None:
        write(tmp_path, "migrations/006.sql", "DELETE FROM sessions;")

        assert migrations.inspect(tmp_path, ["migrations/006.sql"]).reversible is False

    def test_a_delete_with_a_where_clause_does_not(self, tmp_path: Path) -> None:
        write(tmp_path, "migrations/007.sql", "DELETE FROM sessions WHERE expired_at < now();")

        # Scoped to rows the change names, which is an ordinary data fix.
        assert migrations.inspect(tmp_path, ["migrations/007.sql"]).reversible is True

    def test_a_drop_written_in_a_comment_is_not_a_drop(self, tmp_path: Path) -> None:
        write(
            tmp_path,
            "migrations/008.sql",
            "-- We used to DROP TABLE users here; that was a mistake.\n"
            "/* DROP COLUMN email was also considered */\n"
            "ALTER TABLE users ADD COLUMN email text;",
        )

        found = migrations.inspect(tmp_path, ["migrations/008.sql"])

        assert found.reversible is True
        assert found.destructive_statements == []

    def test_reports_every_destructive_statement_it_found(self, tmp_path: Path) -> None:
        write(tmp_path, "migrations/009.sql", "DROP TABLE a;\nTRUNCATE b;")

        found = migrations.inspect(tmp_path, ["migrations/009.sql"])

        # The reviewer needs to know what, not just that.
        assert set(found.destructive_statements) == {"DROP TABLE", "TRUNCATE"}

    def test_a_file_it_cannot_read_is_not_called_reversible(self, tmp_path: Path) -> None:
        """The path is in the diff but the file is gone from the worktree.

        The first version of this test checked `detected` and `rollback_available`
        and never checked `reversible`, which was returning true: an empty list of
        destructive statements reads the same whether the file was additive or
        never opened.
        """
        found = migrations.inspect(tmp_path, ["migrations/010_absent.sql"])

        assert found.detected is True
        assert found.reversible is False
        assert found.rollback_available is False
        assert "unreadable" in found.detail

    def test_one_unreadable_file_taints_a_batch_that_looked_fine(self, tmp_path: Path) -> None:
        write(tmp_path, "migrations/011_add.sql", "CREATE TABLE a (id int);")

        found = migrations.inspect(
            tmp_path, ["migrations/011_add.sql", "migrations/012_absent.sql"]
        )

        # The readable one is additive, which alone would be reversible. The
        # unknown one is what stops the claim.
        assert found.reversible is False

    @pytest.mark.parametrize(
        "path",
        [
            "tests/fixtures/migrations/bad.sql",
            "src/__tests__/migrations/001.sql",
            "testdata/migrations/drop.sql",
            "spec/db/migrate/001_x.rb",
        ],
    )
    def test_a_fixture_is_not_a_migration(self, path: str) -> None:
        """Blocking a pull request over a test fixture is how a check gets disabled."""
        assert not migrations.is_migration_path(path)

    def test_a_real_migration_beside_a_tests_directory_still_counts(self) -> None:
        assert migrations.is_migration_path("packages/database/migrations/0000_init.sql")


class TestInsideTheEngine:
    """The collector's provenance, which is what stops a default being read."""

    def test_an_unreadable_diff_is_unavailable_not_no_migrations(self, tmp_path: Path) -> None:
        """The original bug, wearing a collector entry.

        Reporting "no migrations detected" because the diff could not be read
        would put the same false reassurance back into the manifest, this time
        with provenance claiming someone had looked.
        """
        from proofforge_evidence.context import ChangeContext, RepositoryRef
        from proofforge_evidence.engine import EvidenceEngine
        from proofforge_evidence.models import ConsolidatedEvidence

        repo = tmp_path / "repo"
        repo.mkdir()
        evidence = ConsolidatedEvidence()
        context = ChangeContext(
            repository=RepositoryRef(owner="a", name="b", url="https://example/a/b"),
            commit="9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
            base_commit="1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
            branch="main",
            title="t",
        )

        # tmp_path is not a git repository, so the diff cannot be read.
        EvidenceEngine(_NullToolchain())._collect_operations(repo, context, evidence)

        run = next(r for r in evidence.runs if r.name == "operations")
        assert run.status == "unavailable"
        assert "diff" in run.detail
        # And the fields keep their defaults, which the entry now qualifies.
        assert evidence.operations.migrations_detected is False


class _NullToolchain:
    """The operations collector never touches the toolchain."""

    def run_tests(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")

    def scan_secrets(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")

    def scan_sast(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")

    def scan_vulnerabilities(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")

    def generate_sbom(self, repo: Path):  # noqa: ANN201, ARG002
        raise AssertionError("not used")
