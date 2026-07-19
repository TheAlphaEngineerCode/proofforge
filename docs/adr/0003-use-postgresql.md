# ADR 0003 — Use PostgreSQL for metadata

- Status: Accepted
- Date: 2026-07-18

## Context

ProofForge stores relational, auditable data: organizations, repositories, analyses,
change requests, evidence bundles, policies and audit logs, with strict multi-tenant
isolation.

## Decision

Use **PostgreSQL** as the metadata store, with versioned migrations, foreign keys,
constraints, indexes, timestamps and transactions. Large artifacts (reports, SBOMs) go to
S3-compatible object storage, not the database.

## Consequences

- **Positive:** transactional integrity, mature ecosystem, strong constraints for tenant
  isolation.
- **Negative:** requires a running database for full local development.
- **Mitigation:** Docker Compose provides Postgres locally; the Evidence Spec and CLI work
  without any database.
