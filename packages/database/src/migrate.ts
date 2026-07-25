/**
 * Applying the schema.
 *
 * A deployment with `DATABASE_URL` set and no tables does not fail loudly: the
 * API starts, answers health checks, and returns 500 for everything that
 * touches data. So the schema is applied on the way up rather than left to a
 * step someone has to remember.
 *
 * Two things make that safe to do from the application itself. Applied
 * migrations are recorded, so running it again is a no-op; and the whole run
 * sits behind a PostgreSQL advisory lock, so several instances starting at once
 * queue behind each other instead of racing to create the same table. The lock
 * is held by the session and released when it ends, including if the process
 * dies mid-run — a crash leaves no lock to clean up by hand.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Arbitrary, but fixed forever: two processes only queue behind each other if
 * they ask for the same lock.
 */
const LOCK_KEY = 8_374_221;

const LEDGER = "proofforge_migrations";

export interface MigrationResult {
  /** Names applied by this run, in order. */
  applied: string[];
  /** Names that were already recorded, so this run skipped them. */
  skipped: string[];
}

/** The `migrations/` directory that ships beside this package's build output. */
export function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

export async function migrate(
  connectionString: string,
  migrationsDir: string = defaultMigrationsDir(),
): Promise<MigrationResult> {
  // One connection: the advisory lock below is session-scoped, so a pool that
  // might answer on a second connection would take it and never see it held.
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

  try {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    // The lock comes first, before even the ledger exists. `CREATE TABLE IF NOT
    // EXISTS` is not safe to run concurrently — two instances can both find it
    // absent and the loser fails on a duplicate key in the system catalogue —
    // and serialising every migration except the one that creates the ledger
    // would leave the race in the one place nobody tests.
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;

    try {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql(LEDGER)} (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      const recorded = await sql<{ name: string }[]>`SELECT name FROM ${sql(LEDGER)}`;
      const done = new Set(recorded.map((row) => row.name));

      const applied: string[] = [];
      const skipped: string[] = [];

      for (const name of files) {
        if (done.has(name)) {
          skipped.push(name);
          continue;
        }

        const body = await readFile(join(migrationsDir, name), "utf8");
        await sql.begin(async (tx) => {
          // Drizzle separates statements with a marker rather than by parsing
          // SQL, and a semicolon inside a function body would defeat a split on
          // semicolons. Each piece runs unprepared: DDL takes no parameters.
          for (const statement of body.split("--> statement-breakpoint")) {
            const trimmed = statement.trim();
            if (trimmed !== "") await tx.unsafe(trimmed);
          }
          await tx`INSERT INTO ${sql(LEDGER)} (name) VALUES (${name})`;
        });
        applied.push(name);
      }

      return { applied, skipped };
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
