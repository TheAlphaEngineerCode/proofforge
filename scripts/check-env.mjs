#!/usr/bin/env node
/**
 * Verifies the local toolchain meets ProofForge's minimum requirements.
 * Run with: node scripts/check-env.mjs
 */
import { execSync } from "node:child_process";

const checks = [
  { name: "node", cmd: "node --version", min: "20.11.0" },
  { name: "pnpm", cmd: "pnpm --version", min: "9.0.0" },
];

function parse(v) {
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1, 4).map(Number) : [0, 0, 0];
}

function gte(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return true;
    if (x[i] < y[i]) return false;
  }
  return true;
}

let ok = true;
for (const c of checks) {
  try {
    const out = execSync(c.cmd, { encoding: "utf8" }).trim();
    const pass = gte(out, c.min);
    ok = ok && pass;
    console.log(`${pass ? "✓" : "✗"} ${c.name}: ${out} (needs >= ${c.min})`);
  } catch {
    ok = false;
    console.log(`✗ ${c.name}: not found (needs >= ${c.min})`);
  }
}

process.exit(ok ? 0 : 1);
