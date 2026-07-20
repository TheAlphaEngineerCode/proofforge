/**
 * Counters and histograms, exposed in Prometheus text format.
 *
 * The questions this exists to answer are the ones a log cannot: how often a
 * collector comes back unavailable across every run, where the time goes, what
 * agent runs cost in aggregate. Those are rates and distributions, and reading
 * them off individual log lines means writing the aggregation by hand each time.
 *
 * In-process and unbounded by design — a single API process, scraped. It holds
 * no history: a restart starts the counters again, which is what a scraper
 * expects.
 */

export type Labels = Readonly<Record<string, string>>;

interface Series {
  readonly labels: Labels;
  value: number;
}

interface HistogramSeries {
  readonly labels: Labels;
  count: number;
  sum: number;
  readonly buckets: Map<number, number>;
}

/** Seconds. Chosen around what these operations actually take, not round numbers. */
export const DEFAULT_BUCKETS = [0.05, 0.25, 1, 5, 15, 60, 300] as const;

export class Metrics {
  readonly #counters = new Map<string, Map<string, Series>>();
  readonly #histograms = new Map<string, Map<string, HistogramSeries>>();
  readonly #help = new Map<string, string>();

  /** Register the help text once, so exposition is not littered with it. */
  describe(name: string, help: string): void {
    this.#help.set(name, help);
  }

  increment(name: string, labels: Labels = {}, by = 1): void {
    const series = this.#counters.get(name) ?? new Map<string, Series>();
    const key = labelKey(labels);
    const existing = series.get(key);
    if (existing === undefined) series.set(key, { labels, value: by });
    else existing.value += by;
    this.#counters.set(name, series);
  }

  observe(name: string, seconds: number, labels: Labels = {}): void {
    const series = this.#histograms.get(name) ?? new Map<string, HistogramSeries>();
    const key = labelKey(labels);
    let entry = series.get(key);
    if (entry === undefined) {
      entry = { labels, count: 0, sum: 0, buckets: new Map(DEFAULT_BUCKETS.map((b) => [b, 0])) };
      series.set(key, entry);
    }
    entry.count += 1;
    entry.sum += seconds;
    for (const bound of DEFAULT_BUCKETS) {
      if (seconds <= bound) entry.buckets.set(bound, (entry.buckets.get(bound) ?? 0) + 1);
    }
    this.#histograms.set(name, series);
  }

  /** Time a function and record how long it took, whether or not it threw. */
  async time<T>(name: string, labels: Labels, work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await work();
    } finally {
      // In `finally` on purpose: a call that failed still took time, and
      // leaving it out would make the slowest paths the invisible ones.
      this.observe(name, (Date.now() - started) / 1000, labels);
    }
  }

  /** Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];

    for (const [name, series] of this.#counters) {
      const help = this.#help.get(name);
      if (help !== undefined) lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const entry of series.values()) {
        lines.push(`${name}${renderLabels(entry.labels)} ${entry.value}`);
      }
    }

    for (const [name, series] of this.#histograms) {
      const help = this.#help.get(name);
      if (help !== undefined) lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const entry of series.values()) {
        for (const bound of DEFAULT_BUCKETS) {
          lines.push(
            `${name}_bucket${renderLabels({ ...entry.labels, le: String(bound) })} ${entry.buckets.get(bound) ?? 0}`,
          );
        }
        lines.push(
          `${name}_bucket${renderLabels({ ...entry.labels, le: "+Inf" })} ${entry.count}`,
        );
        lines.push(`${name}_sum${renderLabels(entry.labels)} ${entry.sum}`);
        lines.push(`${name}_count${renderLabels(entry.labels)} ${entry.count}`);
      }
    }

    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }
}

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key] ?? ""}`)
    .join(",");
}

function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const rendered = keys.map((key) => `${key}="${escapeLabel(labels[key] ?? "")}"`);
  return `{${rendered.join(",")}}`;
}

/**
 * A label value comes from a collector name or a status, but those are read
 * from a manifest — so a quote or a newline in one would produce exposition a
 * scraper rejects, and the metric would vanish rather than look wrong.
 */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
