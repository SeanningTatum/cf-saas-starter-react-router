import { describe, expect, it } from "vitest";
import { LogLevel } from "effect";
import { toAppLevel, stringify } from "../logger";

describe("toAppLevel", () => {
  it("maps Trace to trace", () => {
    expect(toAppLevel(LogLevel.Trace)).toBe("trace");
  });

  it("maps Debug to debug", () => {
    expect(toAppLevel(LogLevel.Debug)).toBe("debug");
  });

  it("maps Info to info", () => {
    expect(toAppLevel(LogLevel.Info)).toBe("info");
  });

  it("maps Warning to warn", () => {
    expect(toAppLevel(LogLevel.Warning)).toBe("warn");
  });

  it("maps Error to error", () => {
    expect(toAppLevel(LogLevel.Error)).toBe("error");
  });

  it("maps Fatal to fatal", () => {
    expect(toAppLevel(LogLevel.Fatal)).toBe("fatal");
  });

  it("falls back to info for unmapped levels (e.g. All)", () => {
    expect(toAppLevel(LogLevel.All)).toBe("info");
  });

  it("falls back to info for unmapped levels (e.g. None)", () => {
    expect(toAppLevel(LogLevel.None)).toBe("info");
  });
});

describe("stringify", () => {
  it("returns a string message as-is", () => {
    expect(stringify("hello world")).toBe("hello world");
  });

  it("JSON-stringifies a plain object", () => {
    expect(stringify({ a: 1, b: "two" })).toBe('{"a":1,"b":"two"}');
  });

  it("joins an array of strings with a space", () => {
    expect(stringify(["hello", "world"])).toBe("hello world");
  });

  it("joins a mixed array, JSON-stringifying non-string entries", () => {
    expect(stringify(["msg", { count: 3 }, 42])).toBe(
      'msg {"count":3} 42'
    );
  });
});
