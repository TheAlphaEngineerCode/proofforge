import { migrate } from "@proofforge/database";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDeps } from "./factory.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.databaseUrl === undefined) {
    process.stderr.write(
      "[proofforge-api] DATABASE_URL not set — using in-memory storage (data is not persisted).\n",
    );
  } else {
    // Before anything can serve a request against it. An API that starts on an
    // empty database passes its health check and fails every query behind it,
    // which reads as a broken deployment rather than an unmigrated one.
    try {
      const { applied } = await migrate(config.databaseUrl);
      process.stderr.write(
        applied.length === 0
          ? "[proofforge-api] schema already up to date.\n"
          : `[proofforge-api] applied ${applied.length} migration(s): ${applied.join(", ")}\n`,
      );
    } catch (err) {
      // Refusing to start is the point: serving from a half-known schema would
      // corrupt what the platform exists to keep trustworthy.
      process.stderr.write(`[proofforge-api] could not apply the schema: ${String(err)}\n`);
      process.exit(1);
    }
  }
  if (config.redisUrl === undefined || config.redisUrl === "") {
    process.stderr.write(
      "[proofforge-api] REDIS_URL not set — running analyses in-process (no workers).\n",
    );
  }

  const deps = createDeps(config);
  const app = await buildApp(deps);

  // Close the server on a termination signal so the onClose hook releases the
  // queue and event-bridge connections instead of the process being killed with
  // them open.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
