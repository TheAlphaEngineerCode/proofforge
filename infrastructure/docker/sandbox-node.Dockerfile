# Sandbox image for running a Node repository's tests.
#
# It holds only what is needed to install dependencies and run vitest. The
# repository is mounted read-only and copied to a writable working directory at
# run time, so nothing the tests do can reach the source or the host.
FROM node:20-slim

# The uid must match the one the sandbox runs as (SandboxSpec.user). The image's
# built-in `node` user is uid 1000, so the working directory would be owned by
# someone the container never becomes, and every write would be denied.
RUN corepack enable \
    && corepack prepare pnpm@9.15.0 --activate \
    && useradd --create-home --uid 10001 runner \
    && mkdir -p /work /out \
    && chown runner:runner /work /out

USER runner
WORKDIR /work

# The engine passes the actual script; this is a safe default for a bare run.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["npx vitest run --reporter=junit --outputFile=/out/junit.xml"]
