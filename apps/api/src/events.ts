/**
 * In-process event bus for analysis events.
 *
 * Analyses publish status changes here; SSE connections subscribe per analysis.
 * A distributed deployment (Phase 8) swaps this for Redis/NATS behind the same
 * publish/subscribe shape.
 */
import type { AnalysisEvent, EventPublisher, EventSubscriber } from "@proofforge/shared-types";

type Listener = (event: AnalysisEvent) => void;

export class EventBus implements EventPublisher, EventSubscriber {
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(analysisId: string, event: AnalysisEvent): void {
    const set = this.listeners.get(analysisId);
    if (!set) return;
    for (const listener of set) listener(event);
  }

  subscribe(analysisId: string, listener: Listener): () => void {
    let set = this.listeners.get(analysisId);
    if (!set) {
      set = new Set();
      this.listeners.set(analysisId, set);
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(analysisId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(analysisId);
    };
  }
}
