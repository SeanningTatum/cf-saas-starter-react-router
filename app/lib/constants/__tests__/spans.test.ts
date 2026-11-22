import { describe, expect, it } from "vitest";
import * as spans from "../spans";

const SPAN_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

describe("span names", () => {
  it("follow <service>.<operation> in lower case with dots and underscores, so a trace search by prefix finds every span", () => {
    for (const name of Object.values(spans)) {
      expect(name).toMatch(SPAN_NAME);
    }
  });

  it("are all distinct, so two operations never share one name in a trace", () => {
    const names = Object.values(spans);

    expect(new Set(names).size).toBe(names.length);
  });
});
