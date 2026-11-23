import { describe, expect, it } from "vitest";
import { SMOKE_ATTEMPTS, SMOKE_DELAY_MS, failLine, reasonRelease } from "../smoke-check-constants";

describe("smoke-check-constants", () => {
  it("waits about a minute in all before it gives up, so that a deployment that takes seconds to spread is not rolled back and a broken one is not left live for long", () => {
    const totalMs = (SMOKE_ATTEMPTS - 1) * SMOKE_DELAY_MS;
    expect(totalMs).toBeGreaterThanOrEqual(30_000);
    expect(totalMs).toBeLessThanOrEqual(120_000);
  });

  it("says the wait in seconds and names the page to read, so that the error line is something a person can act on", () => {
    const line = failLine("https://app.example.com/healthz", 6, 10_000, "answered HTTP 500");
    expect(line.startsWith("::error::")).toBe(true);
    expect(line).toContain("6 attempts 10 seconds apart");
    expect(line).toContain("docs/ci/pipelines.md");
  });

  it("names both releases on a mismatch, so that an ignored version pin is plain in the log", () => {
    expect(reasonRelease("v2", "v1")).toContain("answered release v1, expected v2");
  });
});
