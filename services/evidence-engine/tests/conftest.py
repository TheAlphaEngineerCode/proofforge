from collections.abc import Callable
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def read_fixture() -> Callable[[str], str]:
    def _read(name: str) -> str:
        return (FIXTURES / name).read_text(encoding="utf-8")

    return _read
