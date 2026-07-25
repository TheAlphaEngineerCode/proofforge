/**
 * The migration runner, against a real PostgreSQL.
 *
 * There is nothing to test here without one: what the runner is for is the
 * behaviour of `CREATE TABLE IF NOT EXISTS`, of an advisory lock, and of DDL
 * inside a transaction — none of which a fake reproduces. Skipped unless
 * TEST_DATABASE_URL is set; CI runs it against postgres:16.
 */
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "../src/migrate.js";

const url = process.env.TEST_DATABASE_URL;
const describeWithDb = url === undefined ? describe.skip : describe;

describeWithDb("migrate", () => {
  const sql = postgres(url ?? "", { max: 4 });

  /** Back to an empty database, so each test starts where a new deployment does. */
  async function dropEverything(): Promise<void> {
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
  }

  async function tableNames(): Promise<string[]> {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`;
    return rows.map((row) => row.table_name);
  }

  beforeEach(dropEverything);

  afterAll(async () => {
    // Leave the schema in place: the storage suite runs against it.
    await migrate(url ?? "");
    await sql.end();
  });

  it("creates the schema on an empty database", async () => {
    const { applied, skipped } = await migrate(url ?? "");

    expect(applied).toContain("0000_fine_morbius.sql");
    expect(skipped).toEqual([]);
    expect(await tableNames()).toEqual(
      expect.arrayContaining(["users", "organizations", "repositories", "analyses"]),
    );
  });

  it("is a no-op the second time, so every restart is not a migration", async () => {
    await migrate(url ?? "");
    const second = await migrate(url ?? "");

    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain("0000_fine_morbius.sql");
  });

  it("survives instances starting at the same moment", async () => {
    // The case the advisory lock exists for, and the reason the lock is taken
    // before the ledger is created rather than after: concurrent CREATE TABLE IF
    // NOT EXISTS is not safe, and two replicas booting together is the ordinary
    // case, not the rare one.
    const results = await Promise.all([migrate(url ?? ""), migrate(url ?? ""), migrate(url ?? "")]);

    // Exactly one run did the work; the others found it done.
    const applied = results.filter((result) => result.applied.length > 0);
    expect(applied).toHaveLength(1);
    expect(await tableNames()).toContain("users");
  });

  it("refuses a database it cannot reach rather than reporting success", async () => {
    await expect(migrate("postgresql://nobody@127.0.0.1:1/nothing")).rejects.toThrow();
  });
});
