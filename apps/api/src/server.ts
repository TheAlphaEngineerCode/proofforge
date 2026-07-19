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

  const deps = createDeps(config);
  const app = await buildApp(deps);

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
