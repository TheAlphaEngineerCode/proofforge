"""Structured data model for a repository analysis.

Every field is intentionally explicit so the report is stable across runs and can
be serialized to JSON, stored, and later fed into the Risk and Policy engines.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

ANALYSIS_SCHEMA_VERSION = "1.0.0"


class Dependency(BaseModel):
    """A single declared dependency from a package manifest."""

    name: str
    version: str
    ecosystem: str
    dev: bool = False


class LanguageStat(BaseModel):
    """Prevalence of a language, by file and line counts."""

    name: str
    files: int
    lines: int


class Module(BaseModel):
    """A coarse-grained unit of the codebase (a top-level source area or package)."""

    name: str
    path: str
    files: int
    has_tests: bool = False


class GraphNode(BaseModel):
    """A node in the architecture graph (a module or an external resource)."""

    id: str
    kind: str  # "module" | "database" | "queue" | "service"
    label: str


class GraphEdge(BaseModel):
    """A directed relationship between two graph nodes."""

    source: str
    target: str
    kind: str  # "depends_on" | "uses"


class ArchitectureGraph(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


class RiskArea(BaseModel):
    """A flagged area worth human attention before or during review."""

    path: str
    kind: str  # "large_file" | "untested_module" | "no_tests"
    detail: str
    severity: str  # "low" | "medium" | "high"


class AnalysisReport(BaseModel):
    """The full structured result of analyzing a repository."""

    schema_version: str = ANALYSIS_SCHEMA_VERSION
    analyzer_version: str
    root: str
    generated_at: str

    languages: list[LanguageStat] = Field(default_factory=list)
    frameworks: list[str] = Field(default_factory=list)
    package_managers: list[str] = Field(default_factory=list)
    databases: list[str] = Field(default_factory=list)
    infrastructure: list[str] = Field(default_factory=list)
    ci_systems: list[str] = Field(default_factory=list)
    test_frameworks: list[str] = Field(default_factory=list)
    lint_tools: list[str] = Field(default_factory=list)
    containers: list[str] = Field(default_factory=list)
    entrypoints: list[str] = Field(default_factory=list)
    migrations: list[str] = Field(default_factory=list)
    env_vars: list[str] = Field(default_factory=list)
    dependencies: list[Dependency] = Field(default_factory=list)
    modules: list[Module] = Field(default_factory=list)
    architecture_graph: ArchitectureGraph = Field(default_factory=ArchitectureGraph)

    total_files: int = 0
    total_lines: int = 0
    test_files: int = 0
    risk_areas: list[RiskArea] = Field(default_factory=list)
