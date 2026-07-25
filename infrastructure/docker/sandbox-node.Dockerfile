# Sandbox image for running a Node repository's tests.
#
# It holds only what is needed to install dependencies and run vitest. The
# repository is mounted read-only and copied to a writable working directory at
# run time, so nothing the tests do can reach the source or the host.
FROM node:20-slim

# pnpm is installed with npm rather than corepack on purpose. Corepack caches the
# package manager under $COREPACK_HOME, which follows the *current* user's home:
# preparing pnpm as root leaves the `runner` user with an empty cache, so the
# shim silently downloads the newest pnpm on first use instead of the pinned one.
# That version now requires Node >= 22.13 and dies on this image's Node 20 — the
# sandbox would fail to install anything, and a Node repository's tests would
# never run. Installed globally, pnpm needs no network and no writable home,
# which also suits the read-only root filesystem the sandbox imposes.
#
# The uid must match the one the sandbox runs as (SandboxSpec.user). The image's
# built-in `node` user is uid 1000, so the working directory would be owned by
# someone the container never becomes, and every write would be denied.
RUN npm install --global pnpm@9.15.0 \
    && npm cache clean --force \
    && useradd --create-home --uid 10001 runner \
    && mkdir -p /work /out \
    && chown runner:runner /work /out

USER runner
WORKDIR /work

# The engine passes the actual script; this is a safe default for a bare run.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["npx vitest run --reporter=junit --outputFile=/out/junit.xml"]
