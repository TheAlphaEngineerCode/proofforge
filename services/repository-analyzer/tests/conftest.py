from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def node_api() -> Path:
    return FIXTURES / "node-api"


@pytest.fixture
def python_api() -> Path:
    return FIXTURES / "python-api"
