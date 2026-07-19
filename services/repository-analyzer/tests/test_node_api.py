from pathlib import Path

from proofforge_analyzer import analyze_repository


def test_detects_javascript_and_express(node_api: Path) -> None:
    report = analyze_repository(node_api)
    assert "JavaScript" in {lang.name for lang in report.languages}
    assert "Express" in report.frameworks


def test_detects_databases_from_deps(node_api: Path) -> None:
    report = analyze_repository(node_api)
    assert "PostgreSQL" in report.databases
    assert "Redis" in report.databases


def test_detects_npm_docker_ci_jest_eslint(node_api: Path) -> None:
    report = analyze_repository(node_api)
    assert "npm" in report.package_managers
    assert "Docker" in report.infrastructure
    assert "GitHub Actions" in report.ci_systems
    assert "Jest" in report.test_frameworks
    assert "ESLint" in report.lint_tools


def test_detects_entrypoint_migrations_env(node_api: Path) -> None:
    report = analyze_repository(node_api)
    assert "src/index.js" in report.entrypoints
    assert "migrations" in report.migrations
    assert {"PORT", "DATABASE_URL", "REDIS_URL"} <= set(report.env_vars)


def test_graph_connects_module_to_database(node_api: Path) -> None:
    report = analyze_repository(node_api)
    kinds = {node.kind for node in report.architecture_graph.nodes}
    assert "module" in kinds
    assert "database" in kinds
    uses = [e for e in report.architecture_graph.edges if e.kind == "uses"]
    assert any(e.target == "db:PostgreSQL" for e in uses)


def test_module_has_tests_no_risk(node_api: Path) -> None:
    report = analyze_repository(node_api)
    assert report.test_files >= 1
    assert not any(r.kind == "no_tests" for r in report.risk_areas)
