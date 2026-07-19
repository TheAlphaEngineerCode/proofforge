import json
from pathlib import Path

from proofforge_analyzer.analyzer import analyze_repository
from proofforge_analyzer.cli import main
from proofforge_analyzer.scanner import scan_repository


def test_scanner_ignores_vendored_dirs(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.ts").write_text("export const x = 1;\n", encoding="utf-8")
    (tmp_path / "node_modules" / "left-pad").mkdir(parents=True)
    (tmp_path / "node_modules" / "left-pad" / "index.js").write_text("//\n", encoding="utf-8")

    relpaths = {f.relpath for f in scan_repository(tmp_path)}
    assert "src/app.ts" in relpaths
    assert not any(r.startswith("node_modules/") for r in relpaths)


def test_empty_repo_reports_no_tests_when_source_present(tmp_path: Path) -> None:
    (tmp_path / "main.py").write_text("print('hi')\n", encoding="utf-8")
    report = analyze_repository(tmp_path)
    assert any(r.kind == "no_tests" for r in report.risk_areas)


def test_cli_writes_json_output(tmp_path: Path, capsys: object) -> None:
    (tmp_path / "main.py").write_text("x = 1\n", encoding="utf-8")
    out_file = tmp_path / "report.json"

    exit_code = main([str(tmp_path), "--output", str(out_file)])
    assert exit_code == 0

    data = json.loads(out_file.read_text(encoding="utf-8"))
    assert data["schema_version"] == "1.0.0"
    assert data["total_files"] >= 1


def test_cli_bad_path_returns_usage_error() -> None:
    assert main(["/definitely/not/a/real/path/xyz"]) == 2
