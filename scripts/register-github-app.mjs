#!/usr/bin/env node
/**
 * Registers the ProofForge GitHub App with one click.
 *
 * GitHub has no API to create an App outright, but its manifest flow gets close:
 * we hand GitHub a pre-filled manifest, you press "Create GitHub App", and GitHub
 * hands back the app id, private key and webhook secret. This script captures
 * those and writes them where the API expects them — nothing is copied by hand.
 *
 * It also provisions a smee.io channel so webhooks reach a laptop that has no
 * public address.
 *
 * Usage: node scripts/register-github-app.mjs [--name "..."] [--port 4567]
 */
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? 4567);
const APP_NAME = args.name ?? `ProofForge Dev ${randomBytes(2).toString("hex")}`;
const WEBHOOK_PATH = "/api/v1/github/webhook";
const API_PORT = Number(process.env.API_PORT ?? 3001);

/** Least privilege: only what the checks + PR comment flow actually needs. */
const PERMISSIONS = {
  checks: "write", // create and update check runs
  contents: "read", // clone the commit under analysis
  metadata: "read", // mandatory for every app
  pull_requests: "write", // publish the verification comment
};
const EVENTS = ["pull_request", "push", "check_suite"];

async function main() {
  const smeeUrl = await createSmeeChannel();
  console.log(`\n  Webhook proxy: ${smeeUrl}`);

  const state = randomBytes(16).toString("hex");
  const manifest = {
    name: APP_NAME,
    url: "https://github.com/TheAlphaEngineerCode/proofforge",
    description: "Proof-Carrying Change: verifiable evidence for every pull request.",
    hook_attributes: { url: smeeUrl, active: true },
    redirect_url: `http://localhost:${PORT}/callback`,
    public: false,
    default_permissions: PERMISSIONS,
    default_events: EVENTS,
  };

  const credentials = await awaitRegistration(manifest, state);
  await persist(credentials, smeeUrl);

  console.log(`\n  App created: ${credentials.html_url}`);
  console.log(`  App id:      ${credentials.id}`);
  console.log("\n  Wrote .env (app id, webhook secret, escaped private key)");
  console.log("  Wrote .secrets/github-app.pem\n");
  console.log("  Next:");
  console.log(`    1. Install it:  ${credentials.html_url}/installations/new`);
  console.log(`    2. Forward hooks: npx smee-client --url ${smeeUrl} \\`);
  console.log(`         --target http://localhost:${API_PORT}${WEBHOOK_PATH}`);
  console.log("    3. Start the API: pnpm --filter @proofforge/api dev\n");
}

/** smee.io hands out a channel by redirecting /new to it. */
async function createSmeeChannel() {
  const response = await fetch("https://smee.io/new", { method: "HEAD", redirect: "manual" });
  const location = response.headers.get("location");
  if (!location) {
    throw new Error(`smee.io did not return a channel (status ${response.status})`);
  }
  return location;
}

/**
 * Serve the auto-submitting manifest form, then wait for GitHub to redirect back
 * with a short-lived code and exchange it for the credentials.
 */
function awaitRegistration(manifest, state) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(formPage(manifest, state));
        return;
      }

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (url.searchParams.get("state") !== state) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("state mismatch — start over");
          return;
        }
        if (!code) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("missing code");
          return;
        }

        exchange(code).then(
          (credentials) => {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(donePage(credentials));
            server.close();
            resolve(credentials);
          },
          (err) => {
            res.writeHead(500, { "content-type": "text/plain" });
            res.end(String(err));
            server.close();
            reject(err);
          },
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(PORT, () => {
      console.log(`\n  Open this and press "Create GitHub App":\n\n    http://localhost:${PORT}/\n`);
      console.log("  (log in as the account that should own the App)");
    });
    server.on("error", reject);
  });
}

async function exchange(code) {
  const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", "user-agent": "proofforge-setup" },
  });
  if (!response.ok) {
    throw new Error(`manifest conversion failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function persist(credentials, smeeUrl) {
  await mkdir(join(ROOT, ".secrets"), { recursive: true });
  await writeFile(join(ROOT, ".secrets/github-app.pem"), credentials.pem, { mode: 0o600 });

  await upsertEnv({
    GITHUB_APP_ID: String(credentials.id),
    GITHUB_APP_CLIENT_ID: credentials.client_id ?? "",
    GITHUB_APP_CLIENT_SECRET: credentials.client_secret ?? "",
    // Escaped so the PEM survives as a single .env line; the API unescapes it.
    GITHUB_APP_PRIVATE_KEY: credentials.pem.replace(/\n/g, "\\n"),
    GITHUB_WEBHOOK_SECRET: credentials.webhook_secret ?? "",
    SMEE_URL: smeeUrl,
  });
}

/** Merge into .env without disturbing keys the developer already set. */
async function upsertEnv(values) {
  const path = join(ROOT, ".env");
  const current = await readFile(path, "utf8").catch(() => "");
  const lines = current ? current.split(/\r?\n/) : [];

  for (const [key, value] of Object.entries(values)) {
    const rendered = `${key}=${value}`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index === -1) lines.push(rendered);
    else lines[index] = rendered;
  }

  await writeFile(path, `${lines.filter((line, i, all) => line !== "" || i < all.length - 1).join("\n")}\n`);
}

function formPage(manifest, state) {
  return `<!doctype html><meta charset="utf-8"><title>Create the ProofForge GitHub App</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.5">
<h1>Create the ProofForge GitHub App</h1>
<p>You are about to create <strong>${escapeHtml(manifest.name)}</strong> with least-privilege
permissions (checks: write, contents: read, metadata: read, pull requests: write).</p>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
  <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
  <button type="submit" style="padding:.6rem 1rem;font-size:1rem">Continue to GitHub</button>
</form>
<script>document.getElementById("f").submit()</script>
</body>`;
}

function donePage(credentials) {
  return `<!doctype html><meta charset="utf-8"><title>Done</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.5">
<h1>App created</h1>
<p>Credentials were written to <code>.env</code> and <code>.secrets/</code>.
You can close this tab and return to the terminal.</p>
<p><a href="${escapeHtml(credentials.html_url)}/installations/new">Install it on a repository →</a></p>
</body>`;
}

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) out[arg.slice(2)] = argv[i + 1];
  }
  return out;
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
