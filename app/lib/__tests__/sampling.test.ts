import { describe, expect, it } from "vitest";
import { decideSampling, readSampling } from "../sampling";
import {
  PRODUCTION_SAMPLING,
  SAMPLING_BY_ENVIRONMENT,
} from "@/lib/constants/sampling";

const DRAWS = [0, 0.5, 0.999999];

const sequence = (values: ReadonlyArray<number>) => {
  let index = 0;
  const random = () => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
  return { random, calls: () => index };
};

describe("readSampling", () => {
  it("uses the preset of each named environment, so staging does not run on production's trace rate", () => {
    for (const [environment, preset] of Object.entries(SAMPLING_BY_ENVIRONMENT)) {
      expect(readSampling({}, environment)).toEqual(preset);
    }
  });

  it("gives an unknown environment production's rates, so a misnamed deploy cannot export every trace", () => {
    expect(readSampling({}, "qa-typo")).toEqual(PRODUCTION_SAMPLING);
  });

  it("lets each env var override its own rate, including 0, so an operator can turn logs or traces off", () => {
    expect(readSampling({ LOG_SAMPLE_RATE: "0.25" }, "production")).toEqual({
      logs: 0.25,
      traces: PRODUCTION_SAMPLING.traces,
    });
    expect(readSampling({ TRACE_SAMPLE_RATE: "0" }, "development")).toEqual({
      logs: SAMPLING_BY_ENVIRONMENT.development?.logs,
      traces: 0,
    });
    expect(readSampling({ TRACE_SAMPLE_RATE: "1" }, "production").traces).toBe(1);
  });

  it("falls back to the preset for a rate outside 0 to 1 or not a number, so a typo cannot drop every log line", () => {
    for (const raw of ["2", "-1", "abc", "", "  ", "NaN", "Infinity"]) {
      expect(
        readSampling({ LOG_SAMPLE_RATE: raw, TRACE_SAMPLE_RATE: raw }, "production")
      ).toEqual(PRODUCTION_SAMPLING);
    }
  });
});

describe("decideSampling", () => {
  it("keeps at rate 1 and drops at rate 0 whatever the draw, so the presets mean always and never", () => {
    for (const draw of DRAWS) {
      expect(decideSampling({ logs: 1, traces: 1 }, () => draw)).toEqual({
        logs: true,
        traces: true,
      });
      expect(decideSampling({ logs: 0, traces: 0 }, () => draw)).toEqual({
        logs: false,
        traces: false,
      });
    }
  });

  it("draws once for logs and once for traces, so a request kept for logs is not always kept for traces", () => {
    const { random, calls } = sequence([0.05, 0.95]);

    expect(decideSampling({ logs: 0.5, traces: 0.5 }, random)).toEqual({
      logs: true,
      traces: false,
    });
    expect(calls()).toBe(2);
  });
});
