/**
 * DrizzleStorage against a real PostgreSQL.
 *
 * The in-memory backend is what every other test runs on, so its behaviour is
 * well covered and the Postgres one was covered only by the type checker. The
 * two are supposed to be interchangeable, and "it compiles" does not establish
 * that — column types, null handling, timestamp formats and JSON round-trips are
 * all places where they can agree at the type level and differ at runtime.
 *
 * Skipped unless TEST_DATABASE_URL is set, so the ordinary suite stays runnable
 * without a database. Start one with:
 *
 *   docker run -d --name pf-pg-test -e POSTGRES_PASSWORD=proofforge \
 *     -e POSTGRES_DB=proofforge -p 55432:5432 postgres:16-alpine
 *   psql ... -f migrations/0000_fine_morbius.sql
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DrizzleStorage } from "../src/drizzle-storage.js";
import { InMemoryStorage } from "../src/memory.js";
import * as schema from "../src/schema.js";
import type { AuditLog, Storage } from "../src/storage.js";

const url = process.env.TEST_DATABASE_URL;
const describeWithDb = url === undefined ? describe.skip : describe;

describeWithDb("DrizzleStorage against PostgreSQL", () => {
  // The same two lines as createDbClient, kept here because the test needs the
  // underlying client to close the pool — otherwise the run never exits.
  const client = postgres(url ?? "", { max: 4 });
  const db = drizzle(client, { schema });
  const storage: Storage = new DrizzleStorage(db);

  beforeEach(async () => {
    await db.execute(
      sql`truncate audit_logs, evidence_bundles, analyses, policies, repositories, sessions, organizations, users, installations cascade`,
    );
  });

  afterAll(async () => {
    await client.end();
  });

  let seq = 0;

  async function seedOrg(): Promise<string> {
    // Emails are unique in the schema, so each org needs its own owner.
    seq += 1;
    const user = await storage.createUser({ name: `u${seq}`, email: `u${seq}@example.com` });
    const org = await storage.createOrganization({
      name: `o${seq}`,
      slug: `o${seq}`,
      ownerId: user.id,
    });
    return org.id;
  }

  it("round-trips an audit entry, including its JSON metadata", async () => {
    const orgId = await seedOrg();

    await storage.recordAuditLog({
      organizationId: orgId,
      actorType: "policy_exception",
      actorId: "alice@example.com",
      action: "policy.rule_waived",
      targetType: "analysis",
      targetId: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
      metadata: { rule: "security.secretsAllowed", nested: { count: 2 } },
    });

    const [entry] = await storage.listAuditLogs(orgId);

    expect(entry?.actorId).toBe("alice@example.com");
    // jsonb is the field most likely to survive typechecking and fail in fact.
    expect(entry?.metadata).toEqual({ rule: "security.secretsAllowed", nested: { count: 2 } });
    expect(entry?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts an entry with no organization, actor or metadata", async () => {
    await storage.recordAuditLog({ actorType: "system", action: "startup" });

    // Nothing to assert beyond it not throwing: the columns are nullable and the
    // insert must not require what the type says is optional.
    expect(true).toBe(true);
  });

  it("returns entries newest first", async () => {
    const orgId = await seedOrg();

    for (const action of ["first", "second", "third"]) {
      await storage.recordAuditLog({ organizationId: orgId, actorType: "system", action });
    }

    const actions = (await storage.listAuditLogs(orgId)).map((entry) => entry.action);

    expect(actions).toEqual(["third", "second", "first"]);
  });

  it("does not leak entries across organizations", async () => {
    const mine = await seedOrg();
    const theirs = await seedOrg();

    await storage.recordAuditLog({ organizationId: theirs, actorType: "system", action: "x" });

    expect(await storage.listAuditLogs(mine)).toEqual([]);
  });

  it("agrees with the in-memory backend on what it stores", async () => {
    const memory = new InMemoryStorage();
    const orgId = await seedOrg();
    const memoryUser = await memory.createUser({ name: "u", email: "u@example.com" });
    const memoryOrg = await memory.createOrganization({
      name: "o",
      slug: "o",
      ownerId: memoryUser.id,
    });

    const input = {
      actorType: "policy_exception",
      actorId: "alice@example.com",
      action: "policy.rule_waived",
      targetType: "analysis",
      targetId: "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
      metadata: { rule: "security.secretsAllowed" },
    };

    await storage.recordAuditLog({ ...input, organizationId: orgId });
    await memory.recordAuditLog({ ...input, organizationId: memoryOrg.id });

    const [fromPostgres] = await storage.listAuditLogs(orgId);
    const [fromMemory] = await memory.listAuditLogs(memoryOrg.id);

    // The two backends are meant to be swappable, so everything except the
    // generated identifiers and timestamps has to match.
    const comparable = (entry: AuditLog | undefined) => {
      if (entry === undefined) throw new Error("no entry was recorded");
      const { id: _id, organizationId: _org, createdAt: _at, ...rest } = entry;
      return rest;
    };

    expect(comparable(fromPostgres)).toEqual(comparable(fromMemory));
  });

  it("stores and reads back a manifest through an evidence bundle", async () => {
    const orgId = await seedOrg();
    const repo = await storage.createRepository({
      organizationId: orgId,
      owner: "acme",
      name: "api",
      defaultBranch: "main",
      language: null,
      private: false,
    });
    const analysis = await storage.createAnalysis({
      repositoryId: repo.id,
      commitSha: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
    });
    const manifest = { specVersion: "1.1.0", risk: { score: 19 } };

    const bundle = await storage.createEvidenceBundle({
      analysisId: analysis.id,
      commitSha: "9c82fd1a2b3c4d5e6f708192a3b4c5d6e7f80912",
      manifestVersion: "1.1.0",
      riskScore: 19,
      evidenceHash: "sha256:abc",
      manifest,
    });

    expect(await storage.getManifest(bundle.id)).toEqual(manifest);
  });
});
