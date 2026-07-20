import json
from pathlib import Path

from proofforge_analyzer.analyzer import analyze_repository
from proofforge_analyzer.cli import main
from proofforge_analyzer.scanner import scan_repository


def test_scanner_ignores_vendored_dirs(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.ts").write_text("export const x = 1;\n", encoding="utf-8")
    (tmp_path / "node_modules" / "left-pad").mkdir(parents=True)
    (tmp_path / "node_modules" / "left-pad" / "index.js").write_text("//\n", encoding="utf-8")

    relpaths = {f.relpath for f in scan_repository(tmp_path)}
    assert "src/app.ts" in relpaths
    assert not any(r.startswith("node_modules/") for r in relpaths)


def test_scanner_does_not_descend_into_fixture_trees(tmp_path: Path) -> None:
    """A fixture is a miniature project, and its stack is not the host's.

    Descending made the analyzer report Express and Jest for ProofForge itself,
    which uses neither -- a false positive in a report meant to be evidence.
    """
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.ts").write_text("export const x = 1;\n", encoding="utf-8")
    (tmp_path / "tests" / "fixtures" / "node-api").mkdir(parents=True)
    (tmp_path / "tests" / "fixtures" / "node-api" / "package.json").write_text(
        '{"dependencies": {"express": "^4"}}\n', encoding="utf-8"
    )

    relpaths = {f.relpath for f in scan_repository(tmp_path)}

    assert "src/app.ts" in relpaths
    assert not any("fixtures/" in r for r in relpaths)


def test_scanner_keeps_a_fixtures_dir_that_is_just_source(tmp_path: Path) -> None:
    """The name is not the signal; a project manifest is.

    Skipping every directory called fixtures would trade a false positive for a
    silent blind spot, and an unscanned module reports as no module at all.
    """
    (tmp_path / "src" / "fixtures").mkdir(parents=True)
    (tmp_path / "src" / "fixtures" / "users.ts").write_text(
        "export const alice = {};\n", encoding="utf-8"
    )

    relpaths = {f.relpath for f in scan_repository(tmp_path)}

    assert "src/fixtures/users.ts" in relpaths


def test_scanner_still_scans_a_fixture_pointed_at_directly(tmp_path: Path) -> None:
    """Blocking descent must not make a fixture unanalyzable on purpose.

    The analyzer's own tests work by pointing it straight at one.
    """
    root = tmp_path / "fixtures" / "node-api"
    root.mkdir(parents=True)
    (root / "index.js").write_text("//\n", encoding="utf-8")

    assert {f.relpath for f in scan_repository(root)} == {"index.js"}


def test_empty_repo_reports_no_tests_when_source_present(tmp_path: Path) -> None:
    (tmp_path / "main.py").write_text("print('hi')\n", encoding="utf-8")
    report = analyze_repository(tmp_path)
    assert any(r.kind == "no_tests" for r in report.risk_areas)


def test_cli_writes_json_output(tmp_path: Path, capsys: object) -> None:
    (tmp_path / "main.py").write_text("x = 1\n", encoding="utf-8")
    out_file = tmp_path / "report.json"

    exit_code = main([str(tmp_path), "--output", str(out_file)])
    assert exit_code == 0

    data = json.loads(out_file.read_text(encoding="utf-8"))
    assert data["schema_version"] == "1.0.0"
    assert data["total_files"] >= 1


def test_cli_bad_path_returns_usage_error() -> None:
    assert main(["/definitely/not/a/real/path/xyz"]) == 2
