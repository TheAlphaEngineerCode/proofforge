"""Which lines a change actually touched.

Coverage over a whole repository answers a different question from coverage over
the change under review. A one-line addition to an untested module barely moves
the total, and a repository at 90% reports 90% whether or not anyone tested the
lines being added. The number a reviewer needs is the second one.

Reading the diff is the only way to get it, so this module asks git for the
added lines and nothing else — removed lines have no coverage to measure, and
context lines were not part of the change.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

#: `@@ -old,count +new,count @@` — only the new-side range matters here.
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")

_TIMEOUT_S = 60


class DiffUnavailableError(Exception):
    """Raised when the changed lines cannot be determined."""


def changed_lines(repo: Path, base_commit: str, head_commit: str) -> dict[str, set[int]]:
    """Added lines per file, keyed by repository-relative path.

    Raises :class:`DiffUnavailableError` when git cannot answer — a shallow
    clone missing the base commit is the common case. Callers must report that
    rather than substituting a number that measures something else.
    """

    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "diff",
                "--unified=0",
                "--no-color",
                # Renames would otherwise appear as a whole file added, which
                # would count every line of a moved file as newly written.
                "--find-renames",
                "--diff-filter=ACMR",
                f"{base_commit}..{head_commit}",
            ],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as err:
        raise DiffUnavailableError(f"could not run git diff: {err}") from err

    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()
        raise DiffUnavailableError(detail[0] if detail else f"git diff exited {result.returncode}")

    return parse_unified_diff(result.stdout)


def parse_unified_diff(diff_text: str) -> dict[str, set[int]]:
    """Added line numbers per file, from `git diff --unified=0` output."""

    files: dict[str, set[int]] = {}
    current: set[int] | None = None
    line_number = 0

    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            path = line[4:].strip()
            if path == "/dev/null":
                current = None
            else:
                # git writes the new side as `b/path`.
                current = files.setdefault(path[2:] if path.startswith("b/") else path, set())
            continue

        hunk = _HUNK.match(line)
        if hunk is not None:
            line_number = int(hunk.group(1))
            continue

        if current is None:
            continue

        if line.startswith("+"):
            current.add(line_number)
            line_number += 1

    return files
