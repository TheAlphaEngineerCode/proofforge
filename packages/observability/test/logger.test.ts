/**
 * A log line is only worth writing if it can be found again later.
 *
 * These tests hold the shape stable — one JSON object per line, with the
 * context of the run attached — because that shape is what makes a log
 * queryable, and it is the part a refactor breaks silently.
 */
import { describe, expect, it } from "vitest";

import { Logger, type LogRecord } from "../src/logger.js";

function collector(): { records: LogRecord[]; sink: (record: LogRecord) => void } {
  const records: LogRecord[] = [];
  return { records, sink: (record) => records.push(record) };
}

const FIXED_TIME = () => new Date("2026-07-20T12:00:00.000Z");

describe("writing records", () => {
  it("records the level, the message and the time", () => {
    const { records, sink } = collector();

    new Logger({ sink, now: FIXED_TIME }).info("analysis finished");

    expect(records).toEqual([
      {
        time: "2026-07-20T12:00:00.000Z",
        level: "info",
        message: "analysis finished",
        fields: {},
      },
    ]);
  });

  it("drops records below the configured level", () => {
    const { records, sink } = collector();
    const log = new Logger({ level: "warn", sink });

    log.debug("noise");
    log.info("noise");
    log.warn("kept");
    log.error("kept");

    expect(records.map((record) => record.level)).toEqual(["warn", "error"]);
  });
});

describe("child loggers", () => {
  it("carries its fields onto every record", () => {
    const { records, sink } = collector();
    const log = new Logger({ sink, base: { service: "api" } });

    log.child({ analysisId: "an_1" }).info("collector started", { collector: "coverage" });

    expect(records[0]?.fields).toEqual({
      service: "api",
      analysisId: "an_1",
      collector: "coverage",
    });
  });

  it("does not leak its fields back to the logger it came from", () => {
    const { records, sink } = collector();
    const parent = new Logger({ sink });

    parent.child({ analysisId: "an_1" }).info("scoped");
    parent.info("unscoped");

    expect(records[1]?.fields).toEqual({});
  });

  it("lets a call-site field win over an inherited one", () => {
    const { records, sink } = collector();

    new Logger({ sink, base: { step: "collect" } }).info("done", { step: "verify" });

    expect(records[0]?.fields.step).toBe("verify");
  });
});

describe("credentials", () => {
  it("redacts fields", () => {
    const { records, sink } = collector();

    new Logger({ sink }).error("push failed", { token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123" });

    expect(JSON.stringify(records[0])).not.toContain("ABCDEF");
  });

  it("redacts the message too", () => {
    const { records, sink } = collector();

    // Where it usually happens: an error string interpolated whole, by someone
    // who never thought of it as carrying a secret.
    new Logger({ sink }).error("clone failed: https://u:p4ssw0rdvalue@github.com/acme/api.git");

    expect(records[0]?.message).not.toContain("p4ssw0rdvalue");
  });
});
