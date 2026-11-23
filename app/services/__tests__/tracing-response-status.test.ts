import { describe, expect, it } from "vitest";
import { Effect, ManagedRuntime } from "effect";
import { HTTP_STATUS_ATTRIBUTE } from "@/lib/constants/error-reporting";
import { TracingLayer, type FetchLike } from "../tracing";
import { otlpStatusForResponse } from "../tracing-otlp";

const recordingFetch = () => {
  const bodies: string[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    bodies.push(init.body);
    return { ok: true, status: 200 };
  };
  return { bodies, fetchFn };
};

describe("otlpStatusForResponse", () => {
  it("is an error from 500 up and ok below it or for a missing or odd value, so a 4xx never turns a trace red", () => {
    expect(otlpStatusForResponse(500)).toEqual({ code: 2, message: "HTTP 500" });
    expect(otlpStatusForResponse(503).code).toBe(2);
    expect(otlpStatusForResponse(499)).toEqual({ code: 1 });
    expect(otlpStatusForResponse(undefined)).toEqual({ code: 1 });
    expect(otlpStatusForResponse("500")).toEqual({ code: 1 });
  });
});

describe("TracingLayer with a response status on the span", () => {
  it("exports a span that answered 500 as an error and one that answered 200 as ok, so a caught 500 still shows in the trace", async () => {
    const { bodies, fetchFn } = recordingFetch();
    const runtime = ManagedRuntime.make(
      TracingLayer({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }, fetchFn),
    );
    const answered = (name: string, status: number) =>
      Effect.annotateCurrentSpan(HTTP_STATUS_ATTRIBUTE, status).pipe(Effect.withSpan(name));

    await runtime.runPromise(Effect.all([answered("failed", 500), answered("fine", 200)]));
    await runtime.dispose();

    const spans: ReadonlyArray<{ name: string; status: { code: number } }> = JSON.parse(
      bodies[0] ?? "{}",
    ).resourceSpans[0].scopeSpans[0].spans;
    expect(Object.fromEntries(spans.map((s) => [s.name, s.status.code]))).toEqual({
      failed: 2,
      fine: 1,
    });
  });
});
