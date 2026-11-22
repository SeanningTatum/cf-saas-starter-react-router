import { describe, expect, it } from "vitest";
import {
  KEEP_ALL,
  PRODUCTION_SAMPLING,
  SAMPLING_BY_ENVIRONMENT,
} from "../sampling";

describe("sampling presets", () => {
  it("keeps every rate between 0 and 1, so no preset can keep nothing by accident or read as more than always", () => {
    const presets = [KEEP_ALL, PRODUCTION_SAMPLING, ...Object.values(SAMPLING_BY_ENVIRONMENT)];

    for (const { logs, traces } of presets) {
      for (const rate of [logs, traces]) {
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps everything in development, so local debugging never loses a line or a span", () => {
    expect(SAMPLING_BY_ENVIRONMENT.development).toEqual({ logs: 1, traces: 1 });
  });
});
