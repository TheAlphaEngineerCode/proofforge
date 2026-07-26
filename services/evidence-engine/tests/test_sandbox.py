from pathlib import Path

from proofforge_evidence.sandbox import Mount, SandboxSpec, build_docker_command, resolve_image

IMAGE = "ghcr.io/thealphaengineercode/proofforge-sandbox-node:latest"


def _spec(**kwargs: object) -> SandboxSpec:
    base = {
        "image": IMAGE,
        "command": ["pytest", "-q"],
    }
    base.update(kwargs)
    return SandboxSpec(**base)  # type: ignore[arg-type]


def test_command_applies_security_hardening() -> None:
    cmd = build_docker_command(_spec(), container_name="proofforge-sbx-abc")
    joined = " ".join(cmd)

    assert cmd[:3] == ["docker", "run", "--rm"]
    assert "--network none" in joined  # no network by default
    assert "--user 10001:10001" in joined  # non-root
    assert "--memory 1g --memory-swap 1g" in joined  # swap disabled
    assert "--pids-limit 256" in joined  # fork-bomb protection
    assert "--read-only" in cmd
    assert "--cap-drop ALL" in joined
    assert "--security-opt no-new-privileges" in joined
    # the command is appended last, after the image
    assert cmd[-3:] == [IMAGE, "pytest", "-q"]


def test_network_opt_in_switches_to_bridge() -> None:
    cmd = build_docker_command(_spec(network=True), container_name="c")
    assert "--network bridge" in " ".join(cmd)
    assert "--network none" not in " ".join(cmd)


def test_mounts_are_read_only_by_default() -> None:
    spec = _spec(mounts=[Mount(host=Path("."), container="/workspace")])
    cmd = build_docker_command(spec, container_name="c")
    volume_flag = cmd[cmd.index("--volume") + 1]
    assert volume_flag.endswith(":/workspace:ro")


class _Completed:
    def __init__(self, returncode: int, stdout: str) -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = ""


def test_resolve_image_prefers_the_repository_digest(monkeypatch) -> None:
    digest = "ghcr.io/acme/sandbox@sha256:" + "c" * 64

    def fake_run(command, **kwargs):  # noqa: ANN001, ANN003, ARG001
        assert command[:3] == ["docker", "image", "inspect"]
        return _Completed(0, digest + "\n")

    monkeypatch.setattr("proofforge_evidence.sandbox.subprocess.run", fake_run)

    assert resolve_image("ghcr.io/acme/sandbox:3.12") == digest


def test_resolve_image_falls_back_to_the_content_id(monkeypatch) -> None:
    # An image built locally was never pushed, so it has no repository digest.
    # Its content id still identifies the bytes exactly.
    image_id = "sha256:" + "d" * 64
    answers = iter([_Completed(0, "<no value>\n"), _Completed(0, image_id + "\n")])

    monkeypatch.setattr(
        "proofforge_evidence.sandbox.subprocess.run",
        lambda *args, **kwargs: next(answers),  # noqa: ARG005
    )

    assert resolve_image("proofforge-sandbox-node:local") == image_id


def test_resolve_image_returns_the_reference_when_docker_cannot_say(monkeypatch) -> None:
    # A tag rather than a digest, and legible as one to whoever reads the
    # manifest — better than an invented digest or an empty field.
    def fake_run(command, **kwargs):  # noqa: ANN001, ANN003, ARG001
        raise OSError("docker not found")

    monkeypatch.setattr("proofforge_evidence.sandbox.subprocess.run", fake_run)

    assert resolve_image("ghcr.io/acme/sandbox:3.12") == "ghcr.io/acme/sandbox:3.12"
