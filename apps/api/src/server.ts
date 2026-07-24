import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDeps } from "./factory.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.databaseUrl === undefined) {
    process.stderr.write(
      "[proofforge-api] DATABASE_URL not set — using in-memory storage (data is not persisted).\n",
    );
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
