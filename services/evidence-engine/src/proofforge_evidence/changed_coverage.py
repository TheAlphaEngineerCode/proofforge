"""Coverage of the lines a change added.

The rule this module exists to hold: when the changed-line figure cannot be
computed, say so. Substituting the repository total would answer a different
question in the same field, and a policy reading it cannot tell the difference —
it would pass a change on the strength of tests written for other code.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from proofforge_evidence import diff
from proofforge_evidence.collectors import parsers


@dataclass(frozen=True)
class ChangedCoverage:
    """Either a measurement or the reason there is none."""

    percentage: float | None
    #: Added lines the coverage report had something to say about.
    measured_lines: int
    covered_lines: int
    detail: str = ""

    @property
    def measured(self) -> bool:
        return self.percentage is not None


def unavailable(detail: str) -> ChangedCoverage:
    return ChangedCoverage(percentage=None, measured_lines=0, covered_lines=0, detail=detail)


def compute(
    repo: Path,
    base_commit: str,
    head_commit: str,
    coverage_xml: str,
) -> ChangedCoverage:
    """Coverage over the added lines, or an explanation of why it is unknown."""

    try:
        added = diff.changed_lines(repo, base_commit, head_commit)
    except diff.DiffUnavailableError as err:
        return unavailable(f"could not read the diff: {err}")

    if not added:
        # Nothing was added, so there is nothing to have tested. That is not 0%
        # coverage, and reporting it as such would penalise a pure deletion.
        return unavailable("the change added no lines")

    try:
        hits = parsers.parse_cobertura_line_hits(coverage_xml)
    except parsers.ParseError as err:
        return unavailable(f"could not read the coverage report: {err}")

    measured = 0
    covered = 0
    for path, line_numbers in added.items():
        file_hits = _lookup(hits, path)
        if file_hits is None:
            continue
        for line in line_numbers:
            hit_count = file_hits.get(line)
            if hit_count is None:
                # Coverage tools omit lines they do not consider executable —
                # blank lines, comments, an import. Counting them as uncovered
                # would understate every change that adds a comment.
                continue
            measured += 1
            if hit_count > 0:
                covered += 1

    if measured == 0:
        return unavailable("no added line appears in the coverage report")

    return ChangedCoverage(
        percentage=round(covered / measured * 100, 2),
        measured_lines=measured,
        covered_lines=covered,
    )


def _lookup(hits: dict[str, dict[int, int]], path: str) -> dict[int, int] | None:
    """Match a diff path against a coverage path.

    Coverage tools report paths relative to wherever they ran — a source root, a
    package directory — while the diff is relative to the repository. An exact
    match is tried first; otherwise a unique suffix match, since accepting an
    ambiguous one would attribute coverage to the wrong file.
    """

    normalised = path.replace("\\", "/").lstrip("./")
    exact = hits.get(normalised)
    if exact is not None:
        return exact

    candidates = [
        value
        for key, value in hits.items()
        if normalised.endswith(f"/{key}") or key.endswith(f"/{normalised}")
    ]
    return candidates[0] if len(candidates) == 1 else None
