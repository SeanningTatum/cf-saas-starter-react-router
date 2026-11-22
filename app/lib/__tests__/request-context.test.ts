import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { loggers } from "@/lib/logger";
import {
  CurrentRequest,
  currentRequestContext,
  makeRequestContext,
  parseTraceparent,
  randomHex,
  requestLogFields,
  runWithRequestContext,
  setRequestUser,
  type RequestContext,
} from "../request-context";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";
const VALID = `00-${TRACE_ID}-${SPAN_ID}-01`;

const req = (headers: Record<string, string> = {}, url = "https://app.test/dashboard") =>
  new Request(url, { headers });

const context = (over: Partial<RequestContext> = {}): RequestContext => ({
  requestId: "req-1",
  method: "GET",
  path: "/",
  ...over,
});

describe("parseTraceparent", () => {
  it("parses a valid header, sampled flag included", () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      sampled: true,
    });
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)?.sampled).toBe(false);
  });

  it("rejects every malformed shape", () => {
    // The header is attacker-controlled and its trace id becomes the request
    // id, which reaches log lines and the x-request-id header. Catches a
    // loosened pattern letting any of these through.
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent(null)).toBeUndefined();
    expect(parseTraceparent("")).toBeUndefined();
    // wrong length
    expect(parseTraceparent(`00-${TRACE_ID}a-${SPAN_ID}-01`)).toBeUndefined();
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID.slice(1)}-01`)).toBeUndefined();
    // upper-case hex
    expect(parseTraceparent(VALID.toUpperCase())).toBeUndefined();
    // all-zero ids
    expect(parseTraceparent(`00-${"0".repeat(32)}-${SPAN_ID}-01`)).toBeUndefined();
    expect(parseTraceparent(`00-${TRACE_ID}-${"0".repeat(16)}-01`)).toBeUndefined();
    // forbidden version
    expect(parseTraceparent(`ff-${TRACE_ID}-${SPAN_ID}-01`)).toBeUndefined();
    // junk, including a value with a newline (log injection)
    expect(parseTraceparent("hello")).toBeUndefined();
    expect(parseTraceparent(`${VALID}\nforged`)).toBeUndefined();
  });
});

describe("randomHex", () => {
  it("returns 2 lower-case hex characters per byte, different each call", () => {
    // Catches a regression to Math.random-style short ids (the deleted
    // logger helper gave 8 characters).
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(randomHex(16)).not.toBe(randomHex(16));
  });
});

describe("makeRequestContext", () => {
  it("takes the id from a valid traceparent over cf-ray", () => {
    const ctx = makeRequestContext(req({ traceparent: VALID, "cf-ray": "8f1a2b3c4d5e6f70-SJC" }));
    expect(ctx.requestId).toBe(TRACE_ID);
    expect(ctx.parent).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, sampled: true });
  });

  it("takes the id from cf-ray when traceparent is absent or invalid", () => {
    const ctx = makeRequestContext(req({ traceparent: "junk", "cf-ray": "8f1a2b3c4d5e6f70-SJC" }));
    expect(ctx.requestId).toBe("8f1a2b3c4d5e6f70-SJC");
    expect(ctx).not.toHaveProperty("parent");
  });

  it("falls through to a random id when cf-ray is malformed", () => {
    // Catches accepting any cf-ray: a newline would forge log lines, an
    // unbounded value would bloat every line and the response header.
    // (`Headers` itself rejects a raw newline, so a bad character stands in.)
    const withBadChar = makeRequestContext(req({ "cf-ray": "abc def" }));
    const tooLong = makeRequestContext(req({ "cf-ray": "a".repeat(65) }));
    expect(withBadChar.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(tooLong.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(makeRequestContext(req({ "cf-ray": "a".repeat(64) })).requestId).toBe("a".repeat(64));
  });

  it("carries the sampling decision it is given and has no sampled key without one, so an unsampled request stays unsampled and a plain one keeps everything", () => {
    const decision = { logs: false, traces: true };

    expect(makeRequestContext(req(), decision).sampling).toBe(decision);
    expect(makeRequestContext(req())).not.toHaveProperty("sampling");
  });

  it("uses a random id with neither header, and keeps the path without its query", () => {
    // Catches logging the query string, which can carry tokens.
    const ctx = makeRequestContext(
      new Request("https://app.test/reset?token=secret", { method: "POST" })
    );
    expect(ctx.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.method).toBe("POST");
    expect(ctx.path).toBe("/reset");
  });
});

describe("runWithRequestContext / currentRequestContext", () => {
  it("returns the store inside a run and undefined outside", () => {
    const ctx = context();
    expect(currentRequestContext()).toBeUndefined();
    expect(runWithRequestContext(ctx, () => currentRequestContext())).toBe(ctx);
    expect(currentRequestContext()).toBeUndefined();
  });

  it("keeps two overlapping requests apart across an await", async () => {
    // The regression: a module-level "current request" variable instead of
    // the async-local store. Two interleaved requests would read each
    // other's id after the first await.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    const seen = (id: string) =>
      runWithRequestContext(context({ requestId: id }), async () => {
        const before = currentRequestContext()?.requestId;
        await tick();
        return [before, currentRequestContext()?.requestId];
      });

    const [a, b] = await Promise.all([seen("a"), seen("b")]);
    expect(a).toEqual(["a", "a"]);
    expect(b).toEqual(["b", "b"]);
  });
});

describe("plain logger lines inside a request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops an info line and keeps a warn line of a request sampled out for logs, so a plain logger call obeys the request's decision", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    runWithRequestContext(context({ sampling: { logs: false, traces: true } }), () => {
      loggers.server.info("dropped info");
      loggers.server.warn("kept warn");
    });
    runWithRequestContext(context({ sampling: { logs: true, traces: true } }), () => {
      loggers.server.info("kept info");
    });

    const info = infoSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(info).not.toContain("dropped info");
    expect(info).toContain("kept info");
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("kept warn");
  });
});

describe("requestLogFields", () => {
  it("returns {} outside a request", () => {
    expect(requestLogFields(undefined)).toEqual({});
  });

  it("returns the request id, and the user id only once someone is signed in", () => {
    // Catches `userId: undefined` on anonymous lines: the JSON log line would
    // drop it, but a spread would overwrite an explicit userId annotation.
    expect(requestLogFields(context())).toStrictEqual({ requestId: "req-1" });
    expect(requestLogFields(context({ userId: "u1" }))).toStrictEqual({
      requestId: "req-1",
      userId: "u1",
    });
  });
});

describe("setRequestUser", () => {
  it("sets userId on the provided request and user.id on the current span", () => {
    // Catches recording the user on a copy: the logger and the async-local
    // store share this one object, so a copy would leave every later line
    // without userId.
    const ctx = context();
    const span = Effect.runSync(
      Effect.gen(function* () {
        yield* setRequestUser("u1");
        return yield* Effect.currentSpan;
      }).pipe(
        Effect.withSpan("unit.span"),
        Effect.provide(Layer.succeed(CurrentRequest, ctx))
      )
    );

    expect(ctx.userId).toBe("u1");
    expect(span.attributes.get("user.id")).toBe("u1");
  });

  it("is a no-op without a CurrentRequest or without an id", () => {
    const ctx = context();
    const spanWithout = Effect.runSync(
      setRequestUser("u1").pipe(
        Effect.zipRight(Effect.currentSpan),
        Effect.withSpan("unit.span")
      )
    );
    expect(spanWithout.attributes.has("user.id")).toBe(false);

    Effect.runSync(
      setRequestUser(undefined).pipe(Effect.provide(Layer.succeed(CurrentRequest, ctx)))
    );
    expect(ctx).not.toHaveProperty("userId");
  });
});
