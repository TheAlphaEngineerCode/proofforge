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
| OAuth sign-in for the dashboard (signed state, no stored user token) | ✅ |

## Registering the App (automated)

```bash
make github-app     # or: node scripts/register-github-app.mjs

# when the API is already deployed somewhere GitHub can reach:
node scripts/register-github-app.mjs --api-url https://api.example.com
```

The script opens a page that hands GitHub a pre-filled **app manifest**. You press
*Create GitHub App* once; GitHub returns the app id, client id and secret, private
key and webhook secret, and the script writes them to `.env` and
`.secrets/github-app.pem` (both git-ignored). Nothing is copied by hand.

Without `--api-url` it provisions a [smee.io](https://smee.io) channel, so webhooks
reach a machine with no public address and the OAuth callback points at
`localhost`. With it, both point straight at the deployment.

Permissions requested are the minimum the flow needs:

| Permission | Why |
| --- | --- |
| `checks: write` | create and update the Check Run |
| `contents: read` | clone the commit under analysis |
| `metadata: read` | required of every App |
| `pull_requests: write` | publish the verification comment |

Events: `pull_request`, `push`, `check_suite`.

Afterwards:

```bash
# 1. install the App on a repository (the script prints the URL)
# 2. forward webhooks to your local API
npx smee-client --url "$SMEE_URL" --target http://localhost:3001/api/v1/github/webhook
# 3. run the API
pnpm --filter @proofforge/api dev
```

Creating the App still requires your GitHub account and your click — that part
cannot be automated away, and it is the only manual step.

## Registering the App (manual alternative)

If you would rather not use the manifest flow:

1. **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **Webhook URL**: `https://<your-host>/api/v1/github/webhook`
   (for local development use a tunnel such as `smee.io` or `ngrok`).
3. **Callback URL**: `https://<your-host>/api/v1/auth/github/callback` — this is
   what signs people in, and an App without it rejects every login with a
   `redirect_uri` mismatch.
4. **Webhook secret**: generate a strong random value — it must match `GITHUB_WEBHOOK_SECRET`.
5. **Permissions** (least privilege — request nothing beyond these):

   | Scope | Access | Why |
   | --- | --- | --- |
   | Checks | Read & write | publish the verification Check Run |
   | Pull requests | Read & write | read the diff, post the verification comment |
   | Contents | Read-only | read the repository to analyze it |
   | Metadata | Read-only | mandatory for every App |

6. **Subscribe to events**: `pull_request`, `push`, `check_suite`, `installation`.
7. Generate a **private key** and download the `.pem`, and a **client secret** for sign-in.

## Configuration

```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<the secret from step 4>
```

Without `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` the integration stays disabled: webhooks
are still authenticated and recorded, but nothing is published back to GitHub. Without
`GITHUB_WEBHOOK_SECRET` the endpoint returns `503` — it never accepts unauthenticated
deliveries.

## Connecting an installation to an organization

Installing the App tells GitHub to start delivering; it does not say which
ProofForge organization those deliveries belong to. Until someone connects it,
every delivery is acknowledged and ignored, with
`installation is not connected to an organization` as the reason.

```bash
curl -X POST "$API_BASE_URL/api/v1/github/installations/<installation_id>/claim" \
  -H "authorization: Bearer <session token>" \
  -H "content-type: application/json" \
  -d '{"organizationId":"<org uuid>"}'
```

The claim is granted only to the GitHub account that performed the installation.
That account is taken from the `sender` of the `installation` event — a body
GitHub signed — and never from the caller, because installation ids are small
consecutive integers and anything self-asserted would be trivially guessable.

Two consequences worth knowing:

- Sign in with **GitHub**, not dev-login. A dev-login session has no GitHub
  identity and so can never satisfy the check.
- An installation created **before this tracking existed** has no recorded
  installer. GitHub does not redeliver the original `installation` event, so
  there is nothing to check against and the App has to be uninstalled and
  installed again. The API says so explicitly rather than returning a bare
  "forbidden".

## Signing people in

The same App also authenticates *users*. A GitHub App carries its own OAuth
credentials, so the dashboard needs no second OAuth App: the `client_id` that
identifies ProofForge to a repository identifies it to a person too.

The registration script sets the App's **Callback URL** to
`<API_BASE_URL>/api/v1/auth/github/callback` for you; on an App registered by hand,
set it there. Then:

```bash
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=<generated on the App's settings page>
API_BASE_URL=https://api.example.com     # this API's public origin
WEB_BASE_URL=https://app.example.com     # where the browser is sent afterwards
AUTH_STATE_SECRET=<32+ random bytes>     # required in production
```

Without the client id and secret, `GET /api/v1/auth/github` answers `503` and
`GET /api/v1/auth/config` reports `github: false`, so the dashboard offers only
what actually works. **In production that leaves no way in at all** — `dev-login`
is forced off there regardless of the environment.

The flow, and why each part is shaped the way it is:

```text
GET /api/v1/auth/github?redirect=/dashboard
  → sign a 10-minute `state` carrying the redirect
  → hand the browser the same nonce as an HttpOnly cookie  → 302 to GitHub
GET /api/v1/auth/github/callback?code&state
  → verify state, and that the cookie matches it
      (either missing → back to the dashboard with an error code)
  → exchange the code for a user token
  → read /user (and /user/emails when the profile hides the address)
  → match on the numeric GitHub id, create the user if new
  → 302 to WEB_BASE_URL/auth/callback#token=…
```

- **`state` is signed, not stored.** A callback can land on any replica behind a
  load balancer; state held in one process's memory would fail intermittently
  once there are two. That is also why `AUTH_STATE_SECRET` must be *shared* and
  set explicitly in production — locally, a per-process value is generated.
- **And bound to the browser that started the login.** A signature proves only
  that *this service* issued the state, never that it issued it to *this*
  browser. Without the second half, an attacker can authorize with their own
  account, capture the callback URL before using it, and send it to someone
  else — whose browser completes a login into the attacker's account, where
  everything they then connect is visible to the attacker (RFC 6749 §10.12). So
  the nonce inside the state is also set as a short-lived `HttpOnly`,
  `SameSite=Lax` cookie, and the callback requires both. It is `Lax` rather than
  `Strict` because the callback *is* a cross-site top-level navigation, and
  `Strict` would withhold the cookie on the one request that needs it. A browser
  that refuses cookies cannot sign in — that is the trade, and it is the right
  way round.
- **The redirect travels inside the signature**, and only ever as a same-site
  path, so a login URL cannot be crafted into an open redirect.
- **The session arrives in the URL fragment**, which is never sent to a server:
  the token stays out of access logs, proxies and the `Referer` header.
- **The user's GitHub token is used once and dropped.** ProofForge acts on
  repositories with installation tokens, so keeping a personal token would be
  storing a credential it has no use for.
- **Users are matched on the numeric id**, which survives a rename; a login does
  not. A profile with no public address gets GitHub's own stable noreply form.

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

The webhook path has been exercised against real deliveries from a sandbox repository,
which is where four defects that fakes had not shown were found and fixed.

The **OAuth path has not**: it is covered end to end over HTTP with GitHub itself stubbed,
so the routes, the state signing and the session are real while the consent screen is not.
Registering the App with a callback URL and signing in once is the step that would close
this — and, on the evidence of the webhook side, the step that finds what stubs hide.
