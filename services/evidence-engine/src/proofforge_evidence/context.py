"""Input metadata describing the change under analysis."""

from __future__ import annotations

from pydantic import BaseModel


class RepositoryRef(BaseModel):
    provider: str = "github"
    owner: str
    name: str
    url: str


class ChangeContext(BaseModel):
    repository: RepositoryRef
    commit: str
    base_commit: str
    branch: str
    title: str
    request: str = ""
    pull_request: int | None = None
    mode: str = "validation"  # "validation" | "agent"


class Artifact(BaseModel):
    """A persisted raw tool output, referenced from the manifest."""

    name: str
    type: str
    path: str = ""
    sha256: str = ""

    def to_ref(self) -> dict[str, str]:
        ref: dict[str, str] = {"name": self.name, "type": self.type, "url": self.path}
        if self.sha256:
            ref["hash"] = self.sha256
        return ref
