"""A throwaway checkout of the base commit.

Comparing a change against what it branched from means having both on disk at
once. `git worktree` gives a second checkout that shares the object store, which
is cheaper than a clone and leaves the working tree the user is looking at
untouched — this runs on a developer's machine as often as in CI.

It is removed afterwards whatever happens. A worktree left behind holds a lock
in .git and the next run fails on a directory nobody remembers creating.
"""

from __future__ import annotations

import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from proofforge_evidence.diff import DiffUnavailableError, checked_commit

_TIMEOUT_S = 120


@contextmanager
def checkout(repo: Path, commit: str) -> Iterator[Path | None]:
    """Yield a checkout of `commit`, or None when one cannot be made.

    None rather than an exception because a missing base is ordinary — a shallow
    clone does not have it — and the caller's answer is the same either way:
    report that the comparison could not be made.
    """

    try:
        target = checked_commit(commit, "the base commit")
    except DiffUnavailableError:
        yield None
        return

    with tempfile.TemporaryDirectory(prefix="proofforge-base-") as tmp:
        path = Path(tmp) / "tree"
        if not _run(repo, ["worktree", "add", "--detach", str(path), target]):
            yield None
            return
        try:
            yield path
        finally:
            # --force because the sandbox copies the tree and may leave files
            # behind that git would otherwise refuse to discard.
            _run(repo, ["worktree", "remove", "--force", str(path)])
            _run(repo, ["worktree", "prune"])


def _run(repo: Path, args: list[str]) -> bool:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0
