"""Command-line interface for the evidence engine.

Usage:
    proofforge-evidence build --repo PATH --owner O --name N --url URL \
        --commit SHA --base SHA --branch NAME [--pr N] [--title T] \
        [--request R] [--mode validation|agent] [--output-dir DIR]

Exit codes:
    0  bundle built (a valid proof-manifest was produced)
    2  usage error (bad repository path or arguments)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from proofforge_evidence.context import ChangeContext, RepositoryRef
from proofforge_evidence.engine import EngineResult, EvidenceEngine
from proofforge_evidence.toolchain import HostToolchain
from proofforge_evidence.version import __version__


def _ensure_utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="proofforge-evidence",
        description="Run analysis and produce a verifiable proof-manifest.",
    )
    parser.add_argument("--version", action="version", version=f"proofforge-evidence {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="build an evidence bundle for a change")
    build.add_argument("--repo", required=True, help="path to the repository root")
    build.add_argument("--owner", required=True, help="repository owner")
    build.add_argument("--name", required=True, help="repository name")
    build.add_argument("--url", required=True, help="repository URL")
    build.add_argument("--commit", required=True, help="commit SHA under analysis")
    build.add_argument("--base", required=True, help="base commit SHA")
    build.add_argument("--branch", required=True, help="branch name")
    build.add_argument("--pr", type=int, default=None, help="pull request number")
    build.add_argument("--title", default="", help="change title")
    build.add_argument("--request", default="", help="original change request")
    build.add_argument("--mode", choices=["validation", "agent"], default="validation")
    build.add_argument("--provider", default="github", help="repository provider")
    build.add_argument(
        "--output-dir", default=".proofforge/bundle", help="where to write the bundle"
    )
    build.add_argument("--image", default="", help="sandbox image digest recorded in the manifest")
    return parser


def _run_build(args: argparse.Namespace) -> int:
    repo = Path(args.repo)
    if not repo.is_dir():
        print(f"error: not a directory: {repo}", file=sys.stderr)
        return 2

    context = ChangeContext(
        repository=RepositoryRef(
            provider=args.provider, owner=args.owner, name=args.name, url=args.url
        ),
        commit=args.commit,
        base_commit=args.base,
        branch=args.branch,
        pull_request=args.pr,
        title=args.title or f"Change on {args.branch}",
        request=args.request,
        mode=args.mode,
    )

    engine = EvidenceEngine(HostToolchain(), container_image=args.image)
    bundle_dir = Path(args.output_dir)
    result = engine.run(repo, context, bundle_dir)

    print(_render(result))
    return 0


def _render(result: EngineResult) -> str:
    manifest = result.manifest
    risk = manifest["risk"]
    assert isinstance(risk, dict)
    sec = manifest["security"]
    assert isinstance(sec, dict)

    lines = [
        f"Evidence bundle written to {result.bundle_dir}",
        "",
        "  collectors:",
    ]
    for run in result.evidence.runs:
        marker = {"ok": "✓", "unavailable": "·", "error": "✗", "timeout": "✗"}.get(run.status, "?")
        detail = f" — {run.detail}" if run.detail else ""
        lines.append(f"    {marker} {run.name}: {run.status}{detail}")

    tests = result.evidence.tests
    coverage_note = (
        f", coverage {tests.coverage_total:.1f}%" if tests.collected else " (not collected)"
    )
    sbom_note = "yes" if sec["sbomGenerated"] else "no"
    lines += [
        "",
        f"  tests:      {tests.passed} passed, {tests.failed} failed, "
        f"{tests.skipped} skipped{coverage_note}",
        f"  security:   {sec['criticalVulnerabilities']} critical / "
        f"{sec['highVulnerabilities']} high vulns, {sec['secretsDetected']} secrets, "
        f"SBOM={sbom_note}",
        f"  risk:       {risk['score']}/100 — {risk['level']} (interim)",
        f"  manifest:   {result.bundle_dir}/proof-manifest.json",
        f"  hash:       {manifest['evidenceHash']}",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    _ensure_utf8_output()
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "build":
        return _run_build(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
