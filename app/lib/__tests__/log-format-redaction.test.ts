import { afterEach, describe, expect, it, vi } from "vitest";
import { hashEmail } from "../redact";
import { REDACTED, UNWRITABLE_LOG_LINE } from "@/lib/constants/redaction";

const REQUEST_ID = "0123456789abcdef0123456789abcdef";
const FIXED_TIME = new Date(Date.UTC(2026, 10, 22, 8, 30));

const loadJsonFormat = async () => {
  vi.stubEnv("DEV", false);
  vi.resetModules();
  const format = await import("../log-format");
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const lines = (): Array<Record<string, unknown>> =>
    logSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
  return { format, lines };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("emitLog redaction", () => {
  it("masks header values and hashes an email in the annotations, so a logged request cannot leak a session or an address", async () => {
    const { format, lines } = await loadJsonFormat();

    format.emitLog("info", "request", {
      headers: { authorization: "Bearer abc", cookie: "sid=1" },
      user: { email: "user@example.com" },
    });

    expect(lines()[0]).toMatchObject({
      headers: { authorization: REDACTED, cookie: REDACTED },
      user: { email: hashEmail("user@example.com") },
    });
  });

  it("hashes an email inside the message text, so the message is not a way around the field redaction", async () => {
    const { format, lines } = await loadJsonFormat();

    format.emitLog("warn", "sign-in failed for user@example.com");

    expect(lines()[0]?.msg).toBe(
      `sign-in failed for ${hashEmail("user@example.com")}`
    );
  });

  it("redacts the fields from the context provider too, so a field set by the request store cannot skip the mask", async () => {
    const { format, lines } = await loadJsonFormat();
    format.setLogContext(() => ({
      account: { token: "plain-value" },
      contact: "user@example.com",
    }));

    format.emitLog("info", "msg");

    expect(lines()[0]).toMatchObject({
      account: { token: REDACTED },
      contact: hashEmail("user@example.com"),
    });
  });

  it("keeps level, time and a 32-hex request id as they were, so log search still finds the line", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_TIME);
    const { format, lines } = await loadJsonFormat();
    format.setLogContext(() => ({ requestId: REQUEST_ID }));

    format.emitLog("error", "msg");

    expect(lines()[0]).toMatchObject({
      level: "error",
      time: FIXED_TIME.toISOString(),
      requestId: REQUEST_ID,
    });
  });

  it("prints the redacted message in dev format, so a local terminal does not show a raw email", async () => {
    vi.resetModules();
    const format = await import("../log-format");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    format.emitLog("info", "sign-in failed for user@example.com");

    const line = String(infoSpy.mock.calls[0]?.[0]);
    expect(format.isDev).toBe(true);
    expect(line).toContain(hashEmail("user@example.com"));
    expect(line).not.toContain("user@example.com");
  });
});

describe("emitLog sampling", () => {
  it("drops an info line of an unsampled request but writes warn, error and fatal, so sampling never hides a failure", async () => {
    const { format, lines } = await loadJsonFormat();

    for (const level of ["info", "warn", "error", "fatal"] as const) {
      format.emitLog(level, level, {}, false);
    }

    expect(lines().map((line) => line.level)).toEqual(["warn", "error", "fatal"]);
  });

  it("asks the registered sampler when no decision is passed, so a plain logger call inside an unsampled request is dropped", async () => {
    const { format, lines } = await loadJsonFormat();

    format.setLogSampler(() => false);
    format.emitLog("info", "dropped");
    format.setLogSampler(() => true);
    format.emitLog("info", "kept");

    expect(lines().map((line) => line.msg)).toEqual(["kept"]);
  });

  it("lets an explicit decision win over the registered sampler, so an Effect log follows its own request and not the async store", async () => {
    const { format, lines } = await loadJsonFormat();

    format.setLogSampler(() => false);
    format.emitLog("info", "kept", {}, true);
    format.setLogSampler(() => true);
    format.emitLog("info", "dropped", {}, false);

    expect(lines().map((line) => line.msg)).toEqual(["kept"]);
  });
});

describe("emitLog, lines that must always be written", () => {
  it("keeps an info line marked audit when the request is sampled out, so lowering the log rate cannot drop an audit trail", async () => {
    const { format, lines } = await loadJsonFormat();

    format.emitLog("info", "users banned", { audit: true }, false);
    format.emitLog("info", "page viewed", { audit: false }, false);

    expect(lines().map((line) => line.msg)).toEqual(["users banned"]);
  });

  it("writes a fixed line and does not throw when a field cannot be read, so a log call on an error path cannot hide the error", async () => {
    const { format, lines } = await loadJsonFormat();
    const hostile = Object.defineProperty({}, "boom", {
      enumerable: true,
      get: () => {
        throw new Error("trap user@example.com");
      },
    });

    expect(() => format.emitLog("error", "failed", { hostile })).not.toThrow();

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ level: "error", msg: UNWRITABLE_LOG_LINE });
    expect(JSON.stringify(lines()[0])).not.toContain("user@example.com");
  });
});
