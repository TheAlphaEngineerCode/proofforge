from pathlib import Path

from proofforge_evidence.sandbox import Mount, SandboxSpec, build_docker_command


def _spec(**kwargs: object) -> SandboxSpec:
    base = {
        "image": "ghcr.io/proofforge/sandbox-node:latest",
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
    assert cmd[-3:] == ["ghcr.io/proofforge/sandbox-node:latest", "pytest", "-q"]


def test_network_opt_in_switches_to_bridge() -> None:
    cmd = build_docker_command(_spec(network=True), container_name="c")
    assert "--network bridge" in " ".join(cmd)
    assert "--network none" not in " ".join(cmd)


def test_mounts_are_read_only_by_default() -> None:
    spec = _spec(mounts=[Mount(host=Path("."), container="/workspace")])
    cmd = build_docker_command(spec, container_name="c")
    volume_flag = cmd[cmd.index("--volume") + 1]
    assert volume_flag.endswith(":/workspace:ro")
