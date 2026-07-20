"""Detecting database migrations in a change, and whether they can be undone.

An irreversible migration is the one failure a test suite cannot catch and a
rollback cannot fix: once a column is dropped, the data is gone and redeploying
the previous release does not bring it back. That is why the manifest has a
field for it — and why the field asserting `reversible: true` by default, with
nothing looking, was the most dangerous thing in the document.

What this can and cannot establish:

  * It reads the migration files a change touches. Migrations applied by a tool
    that leaves no file behind are invisible to it.
  * "Reversible" means a way back was found: an explicit down migration, or a
    change that only adds things. It is a statement about the files, not a
    promise that running the down would restore the data.
  * A destructive statement with no down migration is reported as irreversible.
    That is a fact about the change, not a guess.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

#: Where migration files live, by convention across the common tools.
_MIGRATION_DIRS = (
    "migrations/",
    "migration/",
    "db/migrate/",
    "alembic/versions/",
    "prisma/migrations/",
    "supabase/migrations/",
    "drizzle/",
)

#: Flyway names files V1__description.sql wherever they sit.
_FLYWAY = re.compile(r"(?:^|/)V\d+(?:[._]\d+)*__.+\.sql$", re.IGNORECASE)

#: Markers that a file carries its own way back.
_DOWN_MARKERS = (
    re.compile(r"^\s*--\s*\+migrate\s+Down", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*--\s*\+goose\s+Down", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*def\s+downgrade\s*\(", re.MULTILINE),
    re.compile(r"\basync\s+down\s*\(", re.IGNORECASE),
    re.compile(r"\bexports?\.down\b", re.IGNORECASE),
    re.compile(r"^\s*def\s+down\b", re.MULTILINE),
)

#: Statements that destroy data. Undoing these needs a backup, not a migration.
_DESTRUCTIVE = (
    (re.compile(r"\bDROP\s+TABLE\b", re.IGNORECASE), "DROP TABLE"),
    (re.compile(r"\bDROP\s+COLUMN\b", re.IGNORECASE), "DROP COLUMN"),
    (re.compile(r"\bDROP\s+DATABASE\b", re.IGNORECASE), "DROP DATABASE"),
    (re.compile(r"\bDROP\s+SCHEMA\b", re.IGNORECASE), "DROP SCHEMA"),
    (re.compile(r"\bTRUNCATE\b", re.IGNORECASE), "TRUNCATE"),
    # A DELETE with no WHERE empties the table.
    (re.compile(r"\bDELETE\s+FROM\s+\S+\s*(?:;|$)", re.IGNORECASE), "DELETE without WHERE"),
)


@dataclass
class MigrationEvidence:
    detected: bool = False
    reversible: bool = True
    rollback_available: bool = True
    files: list[str] = field(default_factory=list)
    #: The statements that make it irreversible, for the reviewer to read.
    destructive_statements: list[str] = field(default_factory=list)
    detail: str = ""


#: A migration under one of these is a fixture, not something that will run.
#: Blocking a pull request over a test fixture is how a check like this ends up
#: switched off, so the false positive costs more than the missed case.
_NOT_REAL = ("/test/", "/tests/", "/__tests__/", "/fixtures/", "/testdata/", "/spec/")


def is_migration_path(path: str) -> bool:
    normalised = path.replace("\\", "/")
    while normalised.startswith("./"):
        normalised = normalised[2:]
    lowered = f"/{normalised.lower()}"

    if any(marker in lowered for marker in _NOT_REAL):
        return False
    if _FLYWAY.search(normalised):
        return True
    return any(directory in lowered for directory in _MIGRATION_DIRS)


def inspect(repo: Path, changed_paths: list[str]) -> MigrationEvidence:
    """Look at the migration files a change touches."""

    migrations = sorted(path for path in changed_paths if is_migration_path(path))
    if not migrations:
        # Nothing to undo. Reversible and rollback-available are true because
        # there is no migration, not because one was judged safe.
        return MigrationEvidence(detail="the change touches no migration files")

    has_down = False
    destructive: list[str] = []
    unread: list[str] = []

    for relative in migrations:
        text = _read(repo / relative)
        if text is None:
            unread.append(relative)
            continue
        if any(marker.search(text) for marker in _DOWN_MARKERS):
            has_down = True
        for pattern, label in _DESTRUCTIVE:
            if pattern.search(_without_comments(text)) and label not in destructive:
                destructive.append(label)

    # A down migration is a way back. Without one, an additive change is still
    # reversible — dropping what was added restores the previous shape — but a
    # destructive one is not, because the data it removed is not in the file.
    #
    # A file we could not read is neither: it is a migration whose contents are
    # unknown, and calling it reversible would assert exactly the safety this
    # collector was written to stop being assumed.
    reversible = has_down or (not destructive and not unread)

    if unread:
        detail = (
            f"{len(migrations)} migration file(s), {len(unread)} unreadable "
            f"({', '.join(unread[:3])}); reversibility could not be established"
        )
    elif has_down:
        detail = f"{len(migrations)} migration file(s), with a down migration"
    elif destructive:
        detail = (
            f"{len(migrations)} migration file(s) with no down migration, containing "
            f"{', '.join(destructive)}"
        )
    else:
        detail = f"{len(migrations)} additive migration file(s), no down migration"

    return MigrationEvidence(
        detected=True,
        reversible=reversible,
        rollback_available=has_down,
        files=migrations,
        destructive_statements=destructive,
        detail=detail,
    )


def _without_comments(sql: str) -> str:
    """Drop comments so a DROP TABLE someone wrote about is not read as one."""

    no_block = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", " ", no_block)


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
