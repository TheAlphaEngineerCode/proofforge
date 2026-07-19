"""ProofForge Repository Analyzer.

Detects languages, frameworks, package managers, databases, infrastructure,
tests, entrypoints, migrations, dependencies and a coarse architecture graph
for a local repository, emitting a structured :class:`AnalysisReport`.

The analyzer is read-only: it never executes repository code (that belongs to
the sandboxed Evidence Engine). All findings come from parsing manifests and
scanning the directory tree.
"""

from proofforge_analyzer.analyzer import analyze_repository
from proofforge_analyzer.models import AnalysisReport
from proofforge_analyzer.version import __version__

__all__ = ["AnalysisReport", "__version__", "analyze_repository"]
