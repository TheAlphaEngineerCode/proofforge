"""Command-line interface for the repository analyzer.

Usage:
    proofforge-analyzer <path> [--json] [--output FILE]

Exit codes:
    0  analysis completed
    2  usage error (bad path)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from proofforge_analyzer.analyzer import analyze_repository
from proofforge_analyzer.models import AnalysisReport
from proofforge_analyzer.version import __version__


def _ensure_utf8_output() -> None:
    """Emit UTF-8 regardless of the platform's default console encoding.

    On Windows the console defaults to a legacy code page (e.g. cp1252) that
    cannot encode characters like the em dash, so summaries would otherwise be
    mojibake. reconfigure() is a no-op where UTF-8 is already in effect.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def _safe(value: str) -> str:
    """Drop control characters before printing untrusted repository-derived text.

    Paths, module names and env keys come from the analyzed repository, which is
    untrusted input; without this a crafted filename could inject ANSI escape
    sequences into the user's terminal.
    """
    return "".join(
        ch for ch in value if not (ord(ch) < 0x20 or 0x7F <= ord(ch) <= 0x9F)
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="proofforge-analyzer",
        description="Analyze a local repository and emit a structured report.",
    )
    parser.add_argument("path", help="path to the repository root to analyze")
    parser.add_argument("--json", action="store_true", help="emit the full report as JSON")
    parser.add_argument("--output", metavar="FILE", help="write the JSON report to FILE")
    parser.add_argument("--version", action="version", version=f"proofforge-analyzer {__version__}")
    return parser


def render_summary(report: AnalysisReport) -> str:
    lines: list[str] = [
        f"ProofForge Repository Analysis — {_safe(report.root)}",
        "",
        f"  files:            {report.total_files} ({report.total_lines} lines)",
        f"  test files:       {report.test_files}",
    ]

    def row(label: str, values: list[str]) -> None:
        rendered = ", ".join(_safe(v) for v in values) if values else "—"
        lines.append(f"  {label:<17} {rendered}")

    top_languages = [f"{lang.name} ({lang.files})" for lang in report.languages[:6]]
    row("languages:", top_languages)
    row("frameworks:", report.frameworks)
    row("package mgrs:", report.package_managers)
    row("databases:", report.databases)
    row("infrastructure:", report.infrastructure)
    row("CI:", report.ci_systems)
    row("test frameworks:", report.test_frameworks)
    row("lint tools:", report.lint_tools)
    row("migrations:", report.migrations)

    lines.append("")
    lines.append(f"  dependencies:     {len(report.dependencies)}")
    lines.append(f"  modules:          {len(report.modules)}")
    lines.append(
        f"  architecture:     {len(report.architecture_graph.nodes)} nodes, "
        f"{len(report.architecture_graph.edges)} edges"
    )

    if report.risk_areas:
        lines.append("")
        lines.append(f"  risk areas ({len(report.risk_areas)}):")
        for risk in report.risk_areas[:10]:
            lines.append(
                f"    [{risk.severity}] {risk.kind}: {_safe(risk.path)} — {_safe(risk.detail)}"
            )

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    _ensure_utf8_output()
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        report = analyze_repository(args.path)
    except (NotADirectoryError, FileNotFoundError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 2

    payload = report.model_dump_json(indent=2)

    if args.output:
        Path(args.output).write_text(payload + "\n", encoding="utf-8")
        print(f"Wrote report to {args.output}")

    if args.json:
        print(payload)
    elif not args.output:
        print(render_summary(report))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
