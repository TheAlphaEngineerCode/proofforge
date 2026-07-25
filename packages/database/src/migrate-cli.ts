/**
 * Apply the schema to `DATABASE_URL`.
 *
 * The API does this on the way up, so this exists for the cases where that is
 * the wrong moment: a migration run against a database before anything is
 * deployed against it, or a check that CI applies the schema through the very
 * same code production does rather than a parallel `psql` invocation that can
 * drift from it.
 */
import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(2);
}

try {
  const { applied, skipped } = await migrate(url);
  for (const name of applied) process.stdout.write(`applied ${name}\n`);
  process.stdout.write(
    applied.length === 0
      ? `schema already up to date (${skipped.length} migration(s) on record)\n`
      : `applied ${applied.length} migration(s)\n`,
  );
} catch (error) {
  process.stderr.write(`migration failed: ${String(error)}\n`);
  process.exit(1);
}
