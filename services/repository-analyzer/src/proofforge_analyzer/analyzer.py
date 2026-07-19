"""Orchestration: turn a directory into a structured :class:`AnalysisReport`."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from proofforge_analyzer import detectors
from proofforge_analyzer.models import (
    AnalysisReport,
    ArchitectureGraph,
    GraphEdge,
    GraphNode,
    LanguageStat,
    Module,
    RiskArea,
)
from proofforge_analyzer.scanner import ScannedFile, scan_repository
from proofforge_analyzer.version import __version__

_LARGE_FILE_LINES = 500
_HUGE_FILE_LINES = 1000
_MAX_LARGE_FILE_RISKS = 20


def analyze_repository(root: Path | str) -> AnalysisReport:
    """Analyze the repository at ``root`` and return a structured report."""

    root_path = Path(root).resolve()
    if not root_path.is_dir():
        raise NotADirectoryError(f"Not a directory: {root_path}")

    files = scan_repository(root_path)
    deps = detectors.collect_dependencies(root_path, files)

    languages = _detect_languages(files)
    modules = _detect_modules(root_path, files)
    databases = detectors.detect_databases(root_path, files, deps)
    graph = _build_graph(root_path, files, modules, databases)

    test_files = [f for f in files if _is_test_file(f)]

    report = AnalysisReport(
        analyzer_version=__version__,
        root=str(root_path),
        generated_at=datetime.now(UTC).isoformat(),
        languages=languages,
        frameworks=detectors.detect_frameworks(deps),
        package_managers=detectors.detect_package_managers(root_path, files),
        databases=databases,
        infrastructure=detectors.detect_infrastructure(files),
        ci_systems=detectors.detect_ci(files),
        test_frameworks=detectors.detect_test_frameworks(root_path, files, deps),
        lint_tools=detectors.detect_lint_tools(root_path, files, deps),
        containers=detectors.detect_containers(files),
        entrypoints=detectors.detect_entrypoints(root_path, files),
        migrations=detectors.detect_migrations(files),
        env_vars=detectors.detect_env_vars(root_path, files),
        dependencies=deps,
        modules=modules,
        architecture_graph=graph,
        total_files=len(files),
        total_lines=sum(f.lines for f in files),
        test_files=len(test_files),
        risk_areas=_detect_risk_areas(files, modules, len(test_files)),
    )
    return report


# ── languages ───────────────────────────────────────────────────────────────


def _detect_languages(files: list[ScannedFile]) -> list[LanguageStat]:
    file_counts: dict[str, int] = defaultdict(int)
    line_counts: dict[str, int] = defaultdict(int)

    for f in files:
        language = detectors.LANGUAGE_BY_EXTENSION.get(f.extension)
        if language is None:
            continue
        file_counts[language] += 1
        line_counts[language] += f.lines

    stats = [
        LanguageStat(name=name, files=count, lines=line_counts[name])
        for name, count in file_counts.items()
    ]
    stats.sort(key=lambda s: (s.lines, s.files, s.name), reverse=True)
    return stats


# ── modules ─────────────────────────────────────────────────────────────────


def _detect_modules(root: Path, files: list[ScannedFile]) -> list[Module]:
    """Derive modules from workspace package manifests, or from ``src`` layout."""

    manifest_dirs: set[str] = set()
    for f in files:
        if f.name in {"package.json", "pyproject.toml", "go.mod", "Cargo.toml"}:
            directory = str(PurePosixPath(f.relpath).parent)
            manifest_dirs.add("" if directory == "." else directory)

    # Workspace/monorepo: multiple manifests in sub-directories.
    sub_dirs = sorted(d for d in manifest_dirs if d)
    if sub_dirs:
        return [_module_for_dir(root, files, d) for d in sub_dirs]

    # Single package: fall back to the immediate children of src/, else the root.
    src_children = _immediate_children(files, "src")
    if src_children:
        return [_module_for_dir(root, files, f"src/{name}") for name in src_children]

    return [_module_for_dir(root, files, "")]


def _immediate_children(files: list[ScannedFile], parent: str) -> list[str]:
    prefix = f"{parent}/"
    children: set[str] = set()
    for f in files:
        if f.relpath.startswith(prefix):
            remainder = f.relpath[len(prefix) :]
            if "/" in remainder:
                children.add(remainder.split("/", 1)[0])
    return sorted(children)


def _module_for_dir(root: Path, files: list[ScannedFile], directory: str) -> Module:
    prefix = "" if directory == "" else f"{directory}/"
    member_files = [f for f in files if f.relpath.startswith(prefix)]
    has_tests = any(_is_test_file(f) for f in member_files)
    name = directory or _root_module_name(root, files)
    return Module(name=name, path=directory or ".", files=len(member_files), has_tests=has_tests)


def _root_module_name(root: Path, files: list[ScannedFile]) -> str:
    pkg = detectors.read_json(root, "package.json")
    if pkg is not None and isinstance(pkg.get("name"), str):
        return str(pkg["name"])
    return root.name


# ── tests ───────────────────────────────────────────────────────────────────

_TEST_DIR_NAMES = frozenset({"test", "tests", "__tests__", "spec"})


def _is_test_file(f: ScannedFile) -> bool:
    parts = f.relpath.split("/")
    if any(part in _TEST_DIR_NAMES for part in parts[:-1]):
        return True
    name = f.name
    if name.endswith((".test.ts", ".test.tsx", ".test.js", ".spec.ts", ".spec.js")):
        return True
    if name.startswith("test_") and name.endswith(".py"):
        return True
    return name.endswith(("_test.py", "_test.go"))


# ── architecture graph ──────────────────────────────────────────────────────


def _build_graph(
    root: Path,
    files: list[ScannedFile],
    modules: list[Module],
    databases: list[str],
) -> ArchitectureGraph:
    nodes: list[GraphNode] = [
        GraphNode(id=f"module:{m.name}", kind="module", label=m.name) for m in modules
    ]
    nodes.extend(GraphNode(id=f"db:{db}", kind="database", label=db) for db in databases)

    edges: list[GraphEdge] = []

    # Map a JS package name to its module id so we can wire workspace dependencies.
    pkg_name_to_module: dict[str, str] = {}
    module_manifest: dict[str, dict[str, str]] = {}
    for module in modules:
        manifest_path = "package.json" if module.path == "." else f"{module.path}/package.json"
        pkg = detectors.read_json(root, manifest_path)
        if pkg is None:
            continue
        name = pkg.get("name")
        if isinstance(name, str):
            pkg_name_to_module[name] = f"module:{module.name}"
        combined: dict[str, str] = {}
        for field in ("dependencies", "devDependencies"):
            section = pkg.get(field)
            if isinstance(section, dict):
                for dep_name, dep_version in section.items():
                    combined[str(dep_name)] = str(dep_version)
        module_manifest[f"module:{module.name}"] = combined

    for module_id, combined in module_manifest.items():
        for dep_name in combined:
            target = pkg_name_to_module.get(dep_name)
            if target is not None and target != module_id:
                edges.append(GraphEdge(source=module_id, target=target, kind="depends_on"))
            db_label = detectors.DATABASE_SIGNATURES.get(dep_name.lower())
            if db_label is not None and db_label in databases:
                edges.append(GraphEdge(source=module_id, target=f"db:{db_label}", kind="uses"))

    # Modules without a JS manifest (e.g. a single Python service) can't be wired
    # from workspace dependencies, so connect them to every detected database.
    for module in modules:
        module_id = f"module:{module.name}"
        if module_id not in module_manifest:
            edges.extend(
                GraphEdge(source=module_id, target=f"db:{db}", kind="uses") for db in databases
            )

    return ArchitectureGraph(nodes=nodes, edges=_dedupe_edges(edges))


def _dedupe_edges(edges: list[GraphEdge]) -> list[GraphEdge]:
    seen: set[tuple[str, str, str]] = set()
    unique: list[GraphEdge] = []
    for edge in edges:
        key = (edge.source, edge.target, edge.kind)
        if key not in seen:
            seen.add(key)
            unique.append(edge)
    return unique


# ── risk areas ──────────────────────────────────────────────────────────────


def _detect_risk_areas(
    files: list[ScannedFile],
    modules: list[Module],
    test_file_count: int,
) -> list[RiskArea]:
    risks: list[RiskArea] = []

    source_files = [
        f for f in files if f.extension in detectors.LANGUAGE_BY_EXTENSION and not _is_test_file(f)
    ]
    large = sorted(
        (f for f in source_files if f.lines >= _LARGE_FILE_LINES),
        key=lambda f: f.lines,
        reverse=True,
    )
    for f in large[:_MAX_LARGE_FILE_RISKS]:
        severity = "high" if f.lines >= _HUGE_FILE_LINES else "medium"
        risks.append(
            RiskArea(
                path=f.relpath,
                kind="large_file",
                detail=f"{f.lines} lines — consider splitting for reviewability",
                severity=severity,
            )
        )

    if test_file_count == 0 and source_files:
        risks.append(
            RiskArea(
                path=".",
                kind="no_tests",
                detail="No test files detected anywhere in the repository",
                severity="high",
            )
        )
    else:
        for module in modules:
            if module.files > 0 and not module.has_tests:
                risks.append(
                    RiskArea(
                        path=module.path,
                        kind="untested_module",
                        detail=f"Module '{module.name}' has no tests",
                        severity="medium",
                    )
                )

    return risks
