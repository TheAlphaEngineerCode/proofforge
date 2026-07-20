/**
 * Reading collector provenance when presenting a manifest.
 *
 * A count is only meaningful next to the fact that something counted. Both the
 * comment and the check run need this, and they need to agree — the check run
 * reported "Secrets detected: 0" for a scan that never ran long after the
 * comment had learned to say so.
 */
import type { Manifest } from "@proofforge/evidence-spec";

export function collectorRan(manifest: Manifest, collector: string): boolean {
  return manifest.collectors.some((entry) => entry.name === collector && entry.status === "ok");
}

/**
 * A measurement, or an explicit statement that there is none.
 *
 * `measured` is what makes this useful: callers must not present the value as a
 * finding without checking it first.
 */
export function measured(
  manifest: Manifest,
  collector: string,
  render: () => string,
): { readonly measured: boolean; readonly text: string } {
  return collectorRan(manifest, collector)
    ? { measured: true, text: render() }
    : { measured: false, text: "not measured" };
}
