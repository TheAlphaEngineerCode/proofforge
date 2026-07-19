# ADR 0006 — Provider-agnostic AI layer

- Status: Accepted
- Date: 2026-07-18

## Context

ProofForge uses LLMs for its agents, but must not be locked to one vendor, and must let
self-hosters choose local models.

## Decision

Define a **provider interface** in `packages/ai-providers` that the core depends on.
Concrete adapters (OpenAI, Anthropic, Ollama/local, future providers) implement it. Core
logic never imports a vendor SDK directly. Prompts, cost and token accounting are handled
at the interface boundary.

## Consequences

- **Positive:** vendor independence; self-hosting with local models; testable via fakes.
- **Negative:** the interface must abstract over differing capabilities (tools, streaming).
- **Mitigation:** keep the interface minimal and capability-flagged; agents degrade
  gracefully when a capability is absent.
