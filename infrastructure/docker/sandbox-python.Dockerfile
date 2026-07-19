# Sandbox image for running a Python repository's tests.
#
# It holds only what is needed to install dependencies and run pytest. The
# repository is mounted read-only and copied to a writable working directory at
# run time, so nothing the tests do can reach the source or the host.
FROM python:3.12-slim

# uv for projects that use it; pip covers the rest.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

RUN pip install --no-cache-dir pytest pytest-cov \
    && useradd --create-home --uid 10001 runner \
    && mkdir -p /work /out \
    && chown runner:runner /work /out

USER runner
WORKDIR /work

# The engine passes the actual script; this is a safe default for a bare run.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["pytest --junitxml=/out/junit.xml --cov --cov-report=xml:/out/coverage.xml"]
