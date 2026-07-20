/**
 * A waived rule leaves a trail.
 *
 * The waiver already reaches the manifest, but a manifest covers one change.
 * Nobody can ask it "who keeps waiving this rule, and how often" — and a rule
 * waived on every change is a rule nobody is enforcing.
 */
import { InMemoryStorage } from "@proofforge/database";
import { describe, expect, it } from "vitest";

import { EventBus } from "../src/events.js";
import { AnalysisRunner } from "../src/services/analysis-runner.js";
import { PolicyGate } from "../src/services/policy-gate.js";

const silent = { warn: () => {} };

/** Blocks on an unmeasured signal, then waives that exact rule. */
const POLICY_WITH_WAIVER = `
version: "1.0"
name: waived
onUnverifiable: fail
security:
  maxCriticalVulnerabilities: 0
exceptions:
  - rule: security.maxCriticalVulnerabilities
    reason: scanner is being rolled out next sprint
    approvedBy: alice@example.com
`;

/** Same rule, no exception — nothing should be waived. */
const POLICY_WITHOUT_WAIVER = `
version: "1.0"
name: plain
onUnverifiable: warn
risk:
  maxAutomaticApprovalScore: 90
`;

async function seed(storage: InMemoryStorage, policyContent: string) {
  const user = await storage.createUser({ name: "u", email: "u@example.com" });
  const org = await storage.createOrganization({ name: "o", slug: "o", ownerId: user.id });
  const repo = await storage.createRepository({
    organizationId: org.id,
    owner: "acme",
    name: "api",
    defaultBranch: "main",
    language: null,
    private: false,
  });
  await storage.createPolicy({
    organizationId: org.id,
    name: "active",
    version: "1.0",
    content: policyContent,
    active: true,
  });
  const analysis = await storage.createAnalysis({
    repositoryId: repo.id,
    commitSha: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
  });
  return { orgId: org.id, analysisId: analysis.id };
}

async function run(storage: InMemoryStorage, analysisId: string) {
  const runner = new AnalysisRunner(
    storage,
    new EventBus(),
    0,
    undefined,
    silent,
    new PolicyGate(storage, silent),
  );
  await runner.start(analysisId);
}

describe("waiving a rule", () => {
  it("writes an entry naming the approver and the rule", async () => {
    const storage = new InMemoryStorage();
    const { orgId, analysisId } = await seed(storage, POLICY_WITH_WAIVER);

    await run(storage, analysisId);

    const waiver = (await storage.listAuditLogs(orgId)).find(
      (entry) => entry.action === "policy.rule_waived",
    );

    expect(waiver).toBeDefined();
    expect(waiver?.actorId).toBe("alice@example.com");
    expect(waiver?.metadata?.rule).toBe("security.maxCriticalVulnerabilities");
  });

  it("ties the entry to the change it waived", async () => {
    const storage = new InMemoryStorage();
    const { orgId, analysisId } = await seed(storage, POLICY_WITH_WAIVER);

    await run(storage, analysisId);

    const waiver = (await storage.listAuditLogs(orgId))[0];

    // Without the commit and hash the entry says a rule was waived somewhere,
    // which is not something anyone can follow up on.
    expect(waiver?.metadata?.commit).toBeDefined();
    expect(waiver?.metadata?.evidenceHash).toBeDefined();
  });

  it("records nothing when no rule was waived", async () => {
    const storage = new InMemoryStorage();
    const { orgId, analysisId } = await seed(storage, POLICY_WITHOUT_WAIVER);

    await run(storage, analysisId);

    expect(await storage.listAuditLogs(orgId)).toEqual([]);
  });

  it("still finishes the analysis when the audit write fails", async () => {
    const storage = new InMemoryStorage();
    const { analysisId } = await seed(storage, POLICY_WITH_WAIVER);
    // The analysis is complete and its verdict is correct; losing the log is
    // worth reporting, not worth discarding the result over.
    storage.recordAuditLog = () => Promise.reject(new Error("database is down"));

    await run(storage, analysisId);

    const analysis = await storage.getAnalysis(analysisId);
    expect(analysis?.status).toBeDefined();
    expect(analysis?.status).not.toBe("FAILED");
  });
});

describe("the audit log itself", () => {
  it("returns entries newest first, even within the same millisecond", async () => {
    const storage = new InMemoryStorage();
    const user = await storage.createUser({ name: "a", email: "a@example.com" });
    const org = await storage.createOrganization({ name: "o", slug: "o", ownerId: user.id });

    // Fast enough that the timestamps collide, which is exactly the case a sort
    // on createdAt cannot order.
    for (const action of ["first", "second", "third"]) {
      await storage.recordAuditLog({ organizationId: org.id, actorType: "system", action });
    }

    const actions = (await storage.listAuditLogs(org.id)).map((entry) => entry.action);

    expect(actions).toEqual(["third", "second", "first"]);
  });

  it("does not leak entries across organizations", async () => {
    const storage = new InMemoryStorage();
    const user = await storage.createUser({ name: "a", email: "a@example.com" });
    const mine = await storage.createOrganization({ name: "m", slug: "m", ownerId: user.id });
    const theirs = await storage.createOrganization({ name: "t", slug: "t", ownerId: user.id });

    await storage.recordAuditLog({ organizationId: theirs.id, actorType: "system", action: "x" });

    expect(await storage.listAuditLogs(mine.id)).toEqual([]);
  });
});
