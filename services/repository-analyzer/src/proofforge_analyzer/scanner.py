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


def scan_repository(root: Path) -> list[ScannedFile]:
    """Return every non-ignored file under ``root`` as a list of ScannedFile."""

    root = root.resolve()
    files: list[ScannedFile] = []

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune ignored directories in place so os.walk does not descend into them.
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]

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
