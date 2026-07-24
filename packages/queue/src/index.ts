/**
 * @proofforge/queue — the job queue and event transport that let the analysis
 * pipeline run in a separate process from the API.
 *
 * The Redis-backed classes connect on construction, so importing this module is
 * free; nothing talks to Redis until a backend is actually built.
 */
export { type JobHandler, type JobQueue } from "./types.js";
export { InMemoryJobQueue, type InMemoryJobQueueOptions } from "./in-memory-queue.js";
export { RedisJobQueue, type RedisJobQueueOptions } from "./redis-queue.js";
export { RedisEventBus, type EventSink } from "./redis-events.js";
