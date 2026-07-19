/**
 * PostgreSQL client factory.
 *
 * Creates a Drizzle client bound to the schema. The Drizzle-backed Storage
 * implementation uses this in production; local development and tests use the
 * in-memory storage, so this module is only imported when a database is present.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

export function createDbClient(connectionString: string): Database {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}
