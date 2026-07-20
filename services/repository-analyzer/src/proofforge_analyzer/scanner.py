"""Directory scanning.

Builds an index of the repository's files while skipping vendored, generated and
version-control directories. Line counting is best-effort and only attempted for
files that look textual, so a stray binary never derails an analysis.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

# Directories we never descend into: vendored deps, build output, caches, VCS.
IGNORED_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        ".venv",
        "venv",
        "env",
        "dist",
        "build",
        "out",
        ".turbo",
        ".next",
        ".nuxt",
        "coverage",
        "target",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        ".gradle",
        ".idea",
        ".vscode",
    }
)

# Names that usually hold fixture projects, but sometimes hold ordinary source.
# The name alone does not settle it -- see _holds_nested_project.
FIXTURE_DIR_NAMES = frozenset({"fixtures", "__fixtures__", "testdata", "test-data"})

# A directory carrying one of these declares a project of its own.
PROJECT_MANIFESTS = frozenset(
    {
        "package.json",
        "pyproject.toml",
        "go.mod",
        "Cargo.toml",
        "pom.xml",
        "build.gradle",
        "composer.json",
        "Gemfile",
    }
)

# Extensions we treat as binary and never line-count.
BINARY_EXTENSIONS = frozenset(
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".ico",
        ".webp",
        ".pdf",
        ".zip",
        ".gz",
        ".tar",
        ".jar",
        ".wasm",
        ".woff",
        ".woff2",
        ".ttf",
        ".otf",
        ".mp4",
        ".mp3",
        ".so",
        ".dll",
        ".dylib",
        ".exe",
        ".bin",
    }
)

_MAX_LINE_COUNT_BYTES = 5_000_000  # skip line counting for very large files


@dataclass(frozen=True)
class ScannedFile:
    """A single file discovered during the scan."""

    relpath: str  # POSIX-style path relative to the repository root
    name: str
    extension: str  # lowercase, includes the dot (e.g. ".ts"); "" if none
    size: int
    lines: int


def _count_lines(path: Path) -> int:
    try:
        if path.stat().st_size > _MAX_LINE_COUNT_BYTES:
            return 0
        with path.open("rb") as handle:
            return sum(1 for _ in handle)
    except OSError:
        return 0


def _holds_nested_project(path: Path) -> bool:
    """True when a fixture-named directory contains a project of its own.

    A fixture tree is a miniature repository, and its stack is not the host's:
    walking into ours made the analyzer report Express, Jest and Docker for
    ProofForge, which uses none of them. That is a false positive in a report
    meant to be evidence.

    A directory merely *called* fixtures may hold perfectly ordinary source, and
    skipping that would trade a false positive for a silent blind spot. A
    manifest is what separates the two, either here or one level down, which is
    the usual fixtures/<project>/package.json shape.
    """

    def declares_project(candidate: Path) -> bool:
        return any((candidate / manifest).exists() for manifest in PROJECT_MANIFESTS)

    try:
        if declares_project(path):
            return True
        return any(child.is_dir() and declares_project(child) for child in path.iterdir())
    except OSError:
        # Unreadable means we cannot claim it is a fixture; scanning it and
        # finding nothing is the safer error.
        return False


def scan_repository(root: Path) -> list[ScannedFile]:
    """Return every non-ignored file under ``root`` as a list of ScannedFile."""

    root = root.resolve()
    files: list[ScannedFile] = []

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune ignored directories in place so os.walk does not descend into
        # them. Only descent is pruned, never the scan root, so pointing the
        # analyzer straight at a fixture still works -- which is how this
        # project's own tests drive it.
        dirnames[:] = [
            d
            for d in dirnames
            if d not in IGNORED_DIRS
            and not (d in FIXTURE_DIR_NAMES and _holds_nested_project(Path(dirpath) / d))
        ]

        for filename in filenames:
            absolute = Path(dirpath) / filename
            relpath = PurePosixPath(absolute.relative_to(root).as_posix())
            extension = absolute.suffix.lower()

            try:
                size = absolute.stat().st_size
            except OSError:
                continue

            lines = 0 if extension in BINARY_EXTENSIONS else _count_lines(absolute)

            files.append(
                ScannedFile(
                    relpath=str(relpath),
                    name=filename,
                    extension=extension,
                    size=size,
                    lines=lines,
                )
            )

    files.sort(key=lambda f: f.relpath)
    return files
