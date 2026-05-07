import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { emitLog, shouldLog } from "../log-format";

describe("shouldLog", () => {
  it("returns true for info level", () => {
    expect(shouldLog("info")).toBe(true);
  });

  it("returns true for error level", () => {
    expect(shouldLog("error")).toBe(true);
  });
});

describe("emitLog", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("info level writes via console.info in dev", () => {
    emitLog("info", "hello", { layer: "test" });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]![0])).toContain("hello");
    expect(String(infoSpy.mock.calls[0]![0])).toContain("[test]");
  });

  it("fatal level routes to console.error", () => {
    emitLog("fatal", "boom", {});
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("trace level routes to console.debug", () => {
    emitLog("trace", "tiny", {});
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it("warn level routes to console.warn", () => {
    emitLog("warn", "watch", {});
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("includes traceId in prefix when provided", () => {
    emitLog("info", "msg", { traceId: "abc123" });
    expect(String(infoSpy.mock.calls[0]![0])).toContain("(abc123)");
  });

  it("appends extra annotations as JSON when present", () => {
    emitLog("info", "msg", { layer: "x", traceId: "t", userId: "u1" });
    expect(String(infoSpy.mock.calls[0]![0])).toContain('"userId":"u1"');
  });
});
