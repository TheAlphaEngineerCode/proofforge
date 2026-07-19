from pathlib import Path

from proofforge_analyzer import analyze_repository


def test_detects_python_and_fastapi(python_api: Path) -> None:
    report = analyze_repository(python_api)
    assert "Python" in {lang.name for lang in report.languages}
    assert "FastAPI" in report.frameworks
    assert "SQLAlchemy (ORM)" in report.frameworks


def test_detects_postgres_from_dep_and_compose(python_api: Path) -> None:
    report = analyze_repository(python_api)
    assert "PostgreSQL" in report.databases
    assert "Docker Compose" in report.infrastructure


def test_detects_pytest_ruff_mypy(python_api: Path) -> None:
    report = analyze_repository(python_api)
    assert "pytest" in report.test_frameworks
    assert "Ruff" in report.lint_tools
    assert "mypy" in report.lint_tools
    assert "pip" in report.package_managers


def test_detects_alembic_migrations(python_api: Path) -> None:
    report = analyze_repository(python_api)
    assert "alembic" in report.migrations
    assert "alembic.ini" in report.migrations


def test_graph_has_database_edge(python_api: Path) -> None:
    report = analyze_repository(python_api)
    uses = [e for e in report.architecture_graph.edges if e.target == "db:PostgreSQL"]
    assert len(uses) >= 1
