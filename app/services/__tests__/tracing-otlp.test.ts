import { describe, expect, it } from "vitest";
import { Effect, ManagedRuntime } from "effect";
import { REDACTED } from "@/lib/constants/redaction";
import { hashEmail } from "@/lib/redact";
import { makeRequestContext } from "@/lib/request-context";
import { observabilityLayer } from "@/runtime";
import type { FetchLike } from "../tracing";
import { toOtlpValue } from "../tracing-otlp";

interface ExportedSpan {
  readonly name: string;
  readonly status: { readonly code: number; readonly message?: string };
  readonly attributes: ReadonlyArray<{
    readonly key: string;
    readonly value: { readonly stringValue?: string };
  }>;
}

const collector = () => {
  const bodies: string[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    bodies.push(init.body);
    return { ok: true, status: 200 };
  };
  const spans = (): ReadonlyArray<ExportedSpan> =>
    JSON.parse(bodies[0] ?? "{}").resourceSpans[0].scopeSpans[0].spans;
  return { fetchFn, spans };
};

const exportFrom = async (url: string, program: Effect.Effect<unknown, unknown>) => {
  const { fetchFn, spans } = collector();
  const runtime = ManagedRuntime.make(
    observabilityLayer(
      { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
      makeRequestContext(new Request(url)),
      fetchFn
    )
  );
  await runtime.runPromiseExit(program);
  await runtime.dispose();
  return spans();
};

describe("toOtlpValue", () => {
  it("hashes an email in a string attribute, so a span cannot carry an address the logs would hide", () => {
    expect(toOtlpValue("user@example.com")).toEqual({
      stringValue: hashEmail("user@example.com"),
    });
  });

  it("masks a credential inside an object attribute, so a JSON-encoded value gets the same mask as text", () => {
    expect(toOtlpValue({ note: "password=hunter2" })).toEqual({
      stringValue: `{"note":"password=${REDACTED}"}`,
    });
  });
});

describe("exported spans", () => {
  it("mask the bound values of a failed query in the span status, so the spans of a failed request cannot leak row data", async () => {
    const spans = await exportFrom(
      "https://app.test/admin",
      Effect.fail(new Error("Failed query: select 1\nparams: fake-row-value")).pipe(
        Effect.withSpan("db.query user")
      )
    );

    const failed = spans.find((span) => span.name === "db.query user");
    expect(failed?.status.code).toBe(2);
    expect(failed?.status.message).toContain("Failed query: select 1");
    expect(JSON.stringify(spans)).not.toContain("fake-row-value");
  });

  it("mask an opaque segment in url.path, so a token in a path cannot reach the trace backend", async () => {
    const spans = await exportFrom(
      "https://app.test/reset/9f8e7d6c5b4a39281706f5e4d3c2b1a0",
      Effect.void
    );

    const request = spans.find((span) => span.name === "http.request");
    const path = request?.attributes.find((attribute) => attribute.key === "url.path");
    expect(path?.value.stringValue).toBe(`/reset/${REDACTED}`);
  });
});

describe("span attributes that text patterns cannot judge", () => {
  it("mask an attribute by its key, so a plain value under a key named token cannot reach the trace backend", async () => {
    const spans = await exportFrom(
      "https://app.test/",
      Effect.annotateCurrentSpan("upload.token", "plain-value").pipe(
        Effect.withSpan("upload.store_file")
      )
    );

    expect(JSON.stringify(spans)).not.toContain("plain-value");
  });

  it("write a marker for a value that cannot be read, so one odd attribute cannot fail the whole export", () => {
    const hostile = Object.defineProperty({}, "boom", {
      enumerable: true,
      get: () => {
        throw new Error("trap");
      },
    });

    expect(toOtlpValue(hostile)).toEqual({ stringValue: "[unprintable]" });
  });

  it("print a cycle as a marker, so an object that holds itself still exports", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(toOtlpValue(circular)).toEqual({ stringValue: '{"self":"[circular]"}' });
  });
});

describe("object attributes", () => {
  it("mask a nested key before the value is printed, so a session inside an object attribute cannot reach the trace backend", () => {
    const printed = toOtlpValue({ session: { id: "plain-value" }, user: { email: "user@example.com" } });

    expect(printed).toEqual({
      stringValue: `{"session":"${REDACTED}","user":{"email":"${hashEmail("user@example.com")}"}}`,
    });
  });

  it("mask a nested key in an event attribute too, so a logged event gets the same mask as a span attribute", async () => {
    const spans = await exportFrom(
      "https://app.test/",
      Effect.logInfo("event").pipe(
        Effect.annotateLogs("details", { token: "plain-value" }),
        Effect.withSpan("upload.store_file")
      )
    );

    expect(JSON.stringify(spans)).not.toContain("plain-value");
  });
});
