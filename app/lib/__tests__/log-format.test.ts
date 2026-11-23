import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { emitLog, shouldLog, isLevelEnabled, setLogContext } from "../log-format";

describe("shouldLog", () => {
  it("returns true for info level", () => {
    expect(shouldLog("info")).toBe(true);
  });

  it("returns true for error level", () => {
    expect(shouldLog("error")).toBe(true);
  });
});

describe("isLevelEnabled", () => {
  it("passes when level is above minLevel", () => {
    expect(isLevelEnabled("error", "info")).toBe(true);
  });

  it("passes when level equals minLevel", () => {
    expect(isLevelEnabled("info", "info")).toBe(true);
  });

  it("filters out when level is below minLevel", () => {
    expect(isLevelEnabled("trace", "info")).toBe(false);
  });

  it("filters out when level is below a fatal-only minLevel", () => {
    expect(isLevelEnabled("error", "fatal")).toBe(false);
  });

  it("everything passes when minLevel is trace", () => {
    expect(isLevelEnabled("trace", "trace")).toBe(true);
    expect(isLevelEnabled("debug", "trace")).toBe(true);
  });
});

describe("emitLog", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogContext(() => ({}));
  });

  it("info level writes via console.info in dev", () => {
    emitLog("info", "hello", { layer: "test" });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain("hello");
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain("[test]");
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
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain("(abc123)");
  });

  it("appends extra annotations as JSON when present", () => {
    emitLog("info", "msg", { layer: "x", traceId: "t", userId: "u1" });
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain('"userId":"u1"');
  });

  it("starts every line from the registered context provider, so plain logger calls inside a request keep their requestId and userId", () => {
    setLogContext(() => ({ requestId: "0123456789abcdef", userId: "u1", extra: 1 }));
    emitLog("info", "msg", { layer: "x" });
    const line = String(infoSpy.mock.calls[0]?.[0]);
    expect(line).toContain('"userId":"u1"');
    expect(line).toContain('"extra":1');
  });

  it("lets explicit annotations win over provider fields, so a log naming its own userId (an admin acting on another user) is not overwritten", () => {
    setLogContext(() => ({ userId: "from-store", extra: 1 }));
    emitLog("info", "msg", { userId: "explicit" });
    const line = String(infoSpy.mock.calls[0]?.[0]);
    expect(line).toContain('"userId":"explicit"');
    expect(line).not.toContain("from-store");
  });

  it("prefixes a dev line with the short request id and moves the trace id to the JSON, so dev lines stay short and the trace stays findable", () => {
    setLogContext(() => ({ requestId: "0123456789abcdef0123456789abcdef" }));
    emitLog("info", "msg", { layer: "x", traceId: "t-1" });
    const line = String(infoSpy.mock.calls[0]?.[0]);
    expect(line).toContain("[x] (01234567) msg");
    expect(line).not.toContain("0123456789abcdef0123456789abcdef");
    expect(line).not.toContain('"requestId"');
    expect(line).toContain('"traceId":"t-1"');
  });

  it("prints a five-letter level and a shorter one with a space between the colour reset and the prefix, so the line reads ERROR [trpc] and INFO  [trpc]", () => {
    emitLog("error", "boom", { layer: "trpc" });
    emitLog("info", "hi", { layer: "trpc" });
    expect(errorSpy.mock.calls[0]?.[0]).toBe("\x1b[31mERROR\x1b[0m [trpc] boom");
    expect(infoSpy.mock.calls[0]?.[0]).toBe("\x1b[32mINFO \x1b[0m [trpc] hi");
  });
});

describe("emitLog outside dev (isDev is read from import.meta.env.DEV at module load and is always true under vitest, so each test stubs it and loads a fresh module)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("writes one JSON line carrying the full requestId and userId, the line log search runs against", async () => {
    vi.stubEnv("DEV", false);
    vi.resetModules();
    const fresh = await import("../log-format");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const requestId = "0123456789abcdef0123456789abcdef";
    fresh.setLogContext(() => ({ requestId, userId: "u1" }));

    fresh.emitLog("info", "msg", { layer: "x" });

    expect(fresh.isDev).toBe(false);
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
      requestId,
      userId: "u1",
      layer: "x",
      level: "info",
      msg: "msg",
    });
  });
});
