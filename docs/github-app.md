# GitHub App

ProofForge integrates with GitHub as an **App**: it receives webhooks, analyzes pull
requests, publishes a Check Run on the commit and posts (or updates) a verification comment.

## What is implemented

| Capability | Status |
| --- | --- |
| Webhook signature verification (HMAC-SHA256, constant-time) | ✅ |
| Event normalization (`pull_request`, `push`, `installation`) | ✅ |
| App JWT (RS256) → installation access token, cached in memory | ✅ |
| Check Runs, PR comments (updated in place), changed files | ✅ |
| Deterministic verdict from the manifest | ✅ |
| Installation records | ✅ |
| Idempotent deliveries (a commit is analyzed once) | ✅ |

## Registering the App

This step is manual — it needs your GitHub account.

1. **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **Webhook URL**: `https://<your-host>/api/v1/github/webhook`
   (for local development use a tunnel such as `smee.io` or `ngrok`).
3. **Webhook secret**: generate a strong random value — it must match `GITHUB_WEBHOOK_SECRET`.
4. **Permissions** (least privilege — request nothing beyond these):

   | Scope | Access | Why |
   | --- | --- | --- |
   | Checks | Read & write | publish the verification Check Run |
   | Pull requests | Read & write | read the diff, post the verification comment |
   | Contents | Read-only | read the repository to analyze it |
   | Metadata | Read-only | mandatory for every App |

5. **Subscribe to events**: `pull_request`, `push`, `check_suite`, `installation`.
6. Generate a **private key** and download the `.pem`.

## Configuration

```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<the secret from step 3>
```

Without `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` the integration stays disabled: webhooks
are still authenticated and recorded, but nothing is published back to GitHub. Without
`GITHUB_WEBHOOK_SECRET` the endpoint returns `503` — it never accepts unauthenticated
deliveries.

## Security model

- **Every delivery is authenticated before it is parsed.** The signature covers the raw
  request bytes, so the endpoint uses a raw-body parser and verifies with a constant-time
  comparison. An invalid or missing signature returns `401` and the payload is discarded.
- **Tokens are short-lived and never persisted.** The App signs a ≤10-minute JWT and
  exchanges it for a 1-hour installation token held only in memory.
- **Repository content is untrusted input.** Titles, branches and file names coming from a
  webhook are treated as data, never as instructions.
- **Deliveries are idempotent.** A commit already analyzed returns the existing analysis
  instead of starting another, so GitHub's retries cannot multiply work.
- Authenticated events that we do not act on are answered `202` so GitHub stops retrying.

## Flow

```text
pull_request.opened
  → verify signature (401 on failure)
  → normalize event
  → repository connected?  no → 202 ignored
  → commit already analyzed?  yes → 202 already_analyzed
  → create analysis + run pipeline
  → publish Check Run + upsert PR comment
```

The comment carries a hidden marker (`<!-- proofforge:verification -->`) so re-runs update
the existing comment rather than adding a new one to the thread.

## Remaining integration step

The code path is complete and tested against fakes. What has not been exercised is a live
delivery from GitHub — that requires the App registration above plus a publicly reachable
webhook URL.
