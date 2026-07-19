"""Sandbox execution.

Untrusted repository code (its test suite) must never run on the host. This module
builds a hardened ``docker run`` invocation and executes it with a hard timeout.

Hardening applied to every sandboxed run:
  - ``--rm`` and a unique name so the container is ephemeral and cleanable;
  - ``--network none`` by default (opt-in allowlist only);
  - a non-root user;
  - CPU, memory (no swap) and PID limits (the PID cap blunts fork bombs);
  - a read-only root filesystem with a size-limited tmpfs for scratch;
  - ``--cap-drop ALL`` and ``--security-opt no-new-privileges``;
  - the repository mounted read-only.

Static scanners that only read files (secret/SAST/vulnerability scans, SBOM) do
not execute repository code and may run on the host; only code execution needs
this sandbox.
"""

from __future__ import annotations

import contextlib
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Mount:
    host: Path
    container: str
    read_only: bool = True


@dataclass(frozen=True)
class SandboxSpec:
    image: str
    command: list[str]
    workdir: str = "/workspace"
    cpus: str = "1.0"
    memory: str = "1g"
    pids_limit: int = 256
    tmpfs_size: str = "256m"
    timeout_s: int = 300
    network: bool = False
    user: str = "10001:10001"
    mounts: list[Mount] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SandboxResult:
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int


def build_docker_command(spec: SandboxSpec, *, container_name: str) -> list[str]:
    """Build the hardened ``docker run`` argument vector for ``spec``."""

    args: list[str] = [
        "docker",
        "run",
        "--rm",
        "--name",
        container_name,
        "--network",
        "bridge" if spec.network else "none",
        "--user",
        spec.user,
        "--cpus",
        spec.cpus,
        "--memory",
        spec.memory,
        "--memory-swap",
        spec.memory,  # equal to --memory disables swap
        "--pids-limit",
        str(spec.pids_limit),
        "--read-only",
        "--tmpfs",
        f"/tmp:rw,size={spec.tmpfs_size}",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--workdir",
        spec.workdir,
    ]

    for mount in spec.mounts:
        suffix = ":ro" if mount.read_only else ""
        args += ["--volume", f"{mount.host.resolve().as_posix()}:{mount.container}{suffix}"]

    for key, value in spec.env.items():
        args += ["--env", f"{key}={value}"]

    args.append(spec.image)
    args += spec.command
    return args


def docker_available() -> bool:
    """Whether a working Docker CLI + daemon is reachable."""

    if shutil.which("docker") is None:
        return False
    try:
        result = subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


class DockerSandbox:
    """Runs a :class:`SandboxSpec` in an ephemeral, hardened Docker container."""

    def run(self, spec: SandboxSpec) -> SandboxResult:
        container_name = f"proofforge-sbx-{uuid.uuid4().hex[:12]}"
        command = build_docker_command(spec, container_name=container_name)

        started = time.monotonic()
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=spec.timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as expired:
            self._force_remove(container_name)
            duration = int((time.monotonic() - started) * 1000)
            return SandboxResult(
                exit_code=124,
                stdout=_as_text(expired.stdout),
                stderr=_as_text(expired.stderr),
                timed_out=True,
                duration_ms=duration,
            )

        duration = int((time.monotonic() - started) * 1000)
        return SandboxResult(
            exit_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
            timed_out=False,
            duration_ms=duration,
        )

    @staticmethod
    def _force_remove(container_name: str) -> None:
        # Best-effort: the client was killed on timeout, so make sure the
        # container cannot linger and hold resources.
        for verb in ("kill", "rm"):
            with contextlib.suppress(OSError, subprocess.SubprocessError):
                subprocess.run(
                    ["docker", verb, container_name],
                    capture_output=True,
                    timeout=15,
                    check=False,
                )


def _as_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value
