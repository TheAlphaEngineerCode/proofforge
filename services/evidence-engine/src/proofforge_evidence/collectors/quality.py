"""Complexity and duplication in the files a change touches.

Two measurements with different footing, so they are reported separately:

  * Complexity is computed from Python's own parser. It is exact for Python and
    is not attempted for anything else — counting braces in TypeScript would
    produce a number that looks like a measurement and is a guess. Files in
    languages this cannot parse are named in the collector's detail so the gap
    is visible rather than averaged away.

  * Duplication is line-based and language-agnostic: windows of normalised lines
    that appear more than once. That is a real signal and a crude one; it finds
    copied blocks and says nothing about structural similarity.

Neither runs the repository. Both read files, which is why they live here rather
than in the sandbox.
"""

from __future__ import annotations

import ast
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from proofforge_evidence.diff import DiffUnavailableError, checked_commit

#: How many consecutive lines must repeat before it counts as duplication.
#: Shorter windows match boilerplate — imports, closing braces — and would
#: report a duplication figure for every file in every language.
_WINDOW = 6

_TIMEOUT_S = 30


@dataclass
class ComplexityEvidence:
    """Total cyclomatic complexity across the changed files, before and after."""

    before: int = 0
    after: int = 0
    measured: bool = False
    #: Files skipped because nothing here can parse them.
    unparsed: list[str] = field(default_factory=list)
    detail: str = ""


@dataclass
class DuplicationEvidence:
    percentage: float = 0.0
    measured: bool = False
    detail: str = ""


def cyclomatic_complexity(source: str) -> int | None:
    """Complexity of a Python module, or None when it does not parse.

    Counts the branch points a reader has to hold in their head: every `if`,
    loop, `except`, `with`, boolean operator, comprehension condition and
    `match` case adds one to the single path through the module.
    """

    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None

    complexity = 1
    for node in ast.walk(tree):
        if isinstance(
            node,
            (
                ast.If,
                ast.For,
                ast.AsyncFor,
                ast.While,
                ast.ExceptHandler,
                ast.With,
                ast.AsyncWith,
            ),
        ):
            complexity += 1
        elif isinstance(node, ast.BoolOp):
            # `a and b and c` is two decisions, not one.
            complexity += len(node.values) - 1
        elif isinstance(node, ast.IfExp):
            complexity += 1
        elif isinstance(node, ast.comprehension):
            complexity += len(node.ifs)
        elif isinstance(node, ast.match_case):
            complexity += 1
    return complexity


def measure_complexity(
    repo: Path, changed_paths: list[str], base_commit: str
) -> ComplexityEvidence:
    """Complexity of the changed Python files, at the base commit and now."""

    python_files = [path for path in changed_paths if path.endswith(".py")]
    others = [path for path in changed_paths if _is_code(path) and not path.endswith(".py")]

    if not python_files:
        detail = (
            "no Python files changed; complexity is only computed for Python"
            if not others
            else f"none of the {len(others)} changed source file(s) are Python"
        )
        return ComplexityEvidence(measured=False, unparsed=others, detail=detail)

    before = 0
    after = 0
    unparsed: list[str] = list(others)

    for relative in python_files:
        current = _read(repo / relative)
        head_score = None if current is None else cyclomatic_complexity(current)
        if head_score is None:
            unparsed.append(relative)
            continue
        after += head_score

        # A file added by this change has no previous version, and git says so
        # by failing; that contributes nothing to the "before" total.
        previous = _show(repo, base_commit, relative)
        base_score = None if previous is None else cyclomatic_complexity(previous)
        if base_score is not None:
            before += base_score

    measured_files = len(python_files) - (len(unparsed) - len(others))
    detail = f"{measured_files} Python file(s) measured"
    if others:
        detail += f"; {len(others)} file(s) in other languages not measured"

    return ComplexityEvidence(
        before=before,
        after=after,
        measured=measured_files > 0,
        unparsed=unparsed,
        detail=detail,
    )


def measure_duplication(repo: Path, changed_paths: list[str]) -> DuplicationEvidence:
    """Share of lines that sit inside a block repeated somewhere in the change."""

    sources = [path for path in changed_paths if _is_code(path)]
    if not sources:
        return DuplicationEvidence(measured=False, detail="the change touches no source files")

    # Where each window occurs, so a repeated one can mark the exact lines it
    # covers. Counting occurrences instead would overcount badly: windows slide,
    # so a twelve-line block repeated once produces seven overlapping windows and
    # would report forty-two duplicated lines out of twelve.
    occurrences: dict[tuple[str, ...], list[tuple[str, int]]] = {}
    per_file: dict[str, list[str]] = {}

    for relative in sources:
        text = _read(repo / relative)
        if text is None:
            continue
        meaningful = [
            stripped
            for stripped in (line.strip() for line in text.splitlines())
            if stripped and not _is_noise(stripped)
        ]
        per_file[relative] = meaningful

        for start in range(len(meaningful) - _WINDOW + 1):
            window = tuple(meaningful[start : start + _WINDOW])
            occurrences.setdefault(window, []).append((relative, start))

    total_lines = sum(len(lines) for lines in per_file.values())
    if total_lines == 0:
        return DuplicationEvidence(
            measured=False, detail="the changed files contain no measurable lines"
        )

    # A line counts once however many repeated windows cover it.
    duplicated: set[tuple[str, int]] = set()
    for window, places in occurrences.items():
        if len(places) < 2:
            continue
        for relative, start in places:
            duplicated.update((relative, start + offset) for offset in range(len(window)))

    percentage = round(len(duplicated) / total_lines * 100, 2)
    return DuplicationEvidence(
        percentage=percentage,
        measured=True,
        detail=f"{total_lines} line(s) across {len(sources)} file(s), {percentage}% repeated",
    )


_CODE_SUFFIXES = (
    ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".go", ".rs", ".java", ".kt", ".rb", ".php", ".cs", ".swift", ".scala",
)


def _is_code(path: str) -> bool:
    return path.endswith(_CODE_SUFFIXES)


def _is_noise(line: str) -> bool:
    """Lines that repeat everywhere and say nothing about duplication."""

    return line in {"{", "}", "});", ")", "],", "};"} or line.startswith(("import ", "from "))


def _show(repo: Path, commit: str, relative: str) -> str | None:
    """The file as it stood at `commit`, or None when it did not exist.

    The commit is validated the same way the diff reader validates it: the
    argument is built as `commit:path`, so a commit beginning with a dash makes
    the whole thing read as an option to git.
    """

    try:
        checked = checked_commit(commit, "the base commit")
    except DiffUnavailableError:
        return None

    try:
        result = subprocess.run(
            ["git", "-C", str(repo), "show", f"{checked}:{relative}"],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 else None


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
