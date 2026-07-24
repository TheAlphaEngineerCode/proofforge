/**
 * Cross-process analysis events over Redis pub/sub.
 *
 * When the worker and the API are the same process, events go straight from the
 * pipeline to the SSE connections through an in-memory bus. Split them apart and
 * that bus no longer sees anything: the run happens in the worker, the browser
 * is connected to the API. This carries the events across.
 *
 * The worker holds one of these and only ever publishes. The API holds one and
 * bridges it into its local bus, so its SSE code keeps subscribing to exactly
 * the same in-memory bus it always did and never learns Redis is involved.
 */
import { Redis } from "ioredis";
import type { AnalysisEvent, EventPublisher } from "@proofforge/shared-types";

const CHANNEL = "proofforge:analysis-events";

interface Envelope {
  readonly analysisId: string;
  readonly event: AnalysisEvent;
}

export type EventSink = (analysisId: string, event: AnalysisEvent) => void;

export class RedisEventBus implements EventPublisher {
  readonly #url: string;
  readonly #publisher: Redis;
  #subscriber: Redis | undefined;

  constructor(url: string) {
    this.#url = url;
    this.#publisher = new Redis(url);
    // An ioredis `error` with no listener is rethrown and ends the process; a
    // Redis blip must not do that when the client will reconnect on its own.
    this.#publisher.on("error", (error: Error) => {
      console.warn(`[events] redis publisher error: ${error.message}`);
    });
  }

  publish(analysisId: string, event: AnalysisEvent): void {
    const envelope: Envelope = { analysisId, event };
    // Fire-and-forget: an event that fails to publish must not fail the run that
    // produced it. The subscriber will simply miss that transition; the analysis
    // record remains the source of truth for the final state.
    void this.#publisher.publish(CHANNEL, JSON.stringify(envelope)).catch(() => {});
  }

  /**
   * Forward every event on the channel to `sink`. A subscribing connection in
   * Redis cannot issue other commands, so this opens a second one dedicated to
   * it. Malformed payloads are dropped rather than thrown — one bad message must
   * not tear down the bridge for every other analysis.
   */
  async bridgeTo(sink: EventSink): Promise<void> {
    if (this.#subscriber !== undefined) {
      throw new Error("bridgeTo() called twice");
    }
    const subscriber = new Redis(this.#url);
    this.#subscriber = subscriber;
    subscriber.on("error", (error: Error) => {
      console.warn(`[events] redis subscriber error: ${error.message}`);
    });
    subscriber.on("message", (_channel: string, message: string) => {
      const envelope = parseEnvelope(message);
      if (envelope !== null) sink(envelope.analysisId, envelope.event);
    });
    await subscriber.subscribe(CHANNEL);
  }

  async close(): Promise<void> {
    await this.#publisher.quit();
    await this.#subscriber?.quit();
  }
}

function parseEnvelope(message: string): Envelope | null {
  try {
    const parsed = JSON.parse(message) as Partial<Envelope>;
    if (typeof parsed.analysisId !== "string" || parsed.event === undefined) return null;
    return { analysisId: parsed.analysisId, event: parsed.event };
  } catch {
    return null;
  }
}
