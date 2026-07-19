# Sandbox image for running a Node repository's tests.
#
# It holds only what is needed to install dependencies and run vitest. The
# repository is mounted read-only and copied to a writable working directory at
# run time, so nothing the tests do can reach the source or the host.
FROM node:20-slim

# pnpm and npm cover the lockfiles we detect; corepack ships with the base image.
RUN corepack enable \
    && corepack prepare pnpm@9.15.0 --activate \
    && mkdir -p /work /out \
    && chown node:node /work /out

USER node
WORKDIR /work

# The engine passes the actual script; this is a safe default for a bare run.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["npx vitest run --reporter=junit --outputFile=/out/junit.xml"]
