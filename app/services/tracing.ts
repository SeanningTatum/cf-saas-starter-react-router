import { Context, Effect, Exit, Layer, Option, Tracer } from "effect";

/**
 * Env-driven OTLP span export for Effect's tracer.
 *
 * When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset the layer is `Layer.empty` —
 * Effect's default in-memory tracer still runs (so logs keep traceId
 * correlation) but nothing is exported. When set, a custom `Tracer` buffers
 * every ended span and a scope finalizer flushes them as one OTLP/HTTP JSON
 * request when the request-scoped runtime is disposed (the worker wraps
 * `runtime.dispose()` in `ctx.waitUntil`, so the flush never blocks the
 * response).
 *
 * Backend-agnostic: any OTLP-compatible collector works (Jaeger, Grafana,
 * Honeycomb, Axiom, Logfire, otel-tui) — see `.brain/codebase/observability.md`.
 */

export interface TracingConfig {
  /** Full OTLP traces URL — `/v1/traces` appended when missing. */
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly serviceName: string;
}

// The OTEL_* vars are optional secrets — they never appear in the generated
// `Env` type unless the deployer sets them, so they're read defensively off
// the env object rather than typed on it.
const readEnvString = (env: object, key: string): string | undefined => {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/**
 * W3C correlation-context format: `key=value,key2=value2`, values may be
 * percent-encoded (`Authorization=Bearer%20abc`).
 */
export const parseOtlpHeaders = (
  raw: string | undefined
): Record<string, string> => {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!key) continue;
    headers[key] = decodePercent(value);
  }
  return headers;
};

const decodePercent = (value: string): string => {
  if (!value.includes("%")) return value;
  const decoded = Effect.runSync(
    Effect.try(() => decodeURIComponent(value)).pipe(
      Effect.orElseSucceed(() => value)
    )
  );
  return decoded;
};

export const readTracingConfig = (env: object): TracingConfig | null => {
  const endpoint = readEnvString(env, "OTEL_EXPORTER_OTLP_ENDPOINT");
  if (!endpoint) return null;
  const base = endpoint.replace(/\/+$/, "");
  return {
    url: base.endsWith("/v1/traces") ? base : `${base}/v1/traces`,
    headers: parseOtlpHeaders(readEnvString(env, "OTEL_EXPORTER_OTLP_HEADERS")),
    serviceName: readEnvString(env, "OTEL_SERVICE_NAME") ?? "cf-saas-starter",
  };
};

// --- Span implementation -----------------------------------------------------

const randomHex = (bytes: number): string => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
};

interface SpanEvent {
  readonly name: string;
  readonly startTime: bigint;
  readonly attributes: Record<string, unknown>;
}

/** Buffer memory bound — beyond this, spans are counted as dropped, not kept. */
export const MAX_BUFFERED_SPANS = 1000;

export interface SpanBuffer {
  readonly spans: OtlpSpan[];
  dropped: number;
}

export const makeSpanBuffer = (): SpanBuffer => ({ spans: [], dropped: 0 });

export class OtlpSpan implements Tracer.Span {
  readonly _tag = "Span";
  readonly spanId: string;
  readonly traceId: string;
  readonly sampled = true;
  readonly context: Context.Context<never> = Context.empty();
  status: Tracer.SpanStatus;
  readonly attributes = new Map<string, unknown>();
  readonly events: SpanEvent[] = [];
  links: ReadonlyArray<Tracer.SpanLink>;

  constructor(
    readonly name: string,
    readonly parent: Option.Option<Tracer.AnySpan>,
    links: ReadonlyArray<Tracer.SpanLink>,
    startTime: bigint,
    readonly kind: Tracer.SpanKind,
    private readonly buffer: SpanBuffer
  ) {
    this.spanId = randomHex(8);
    this.traceId = Option.isSome(parent)
      ? parent.value.traceId
      : randomHex(16);
    this.status = { _tag: "Started", startTime };
    this.links = links;
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    this.status = {
      _tag: "Ended",
      startTime: this.status.startTime,
      endTime,
      exit,
    };
    if (this.buffer.spans.length >= MAX_BUFFERED_SPANS) {
      this.buffer.dropped += 1;
      return;
    }
    this.buffer.spans.push(this);
  }

  attribute(key: string, value: unknown): void {
    this.attributes.set(key, value);
  }

  event(
    name: string,
    startTime: bigint,
    attributes?: Record<string, unknown>
  ): void {
    this.events.push({ name, startTime, attributes: attributes ?? {} });
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    this.links = [...this.links, ...links];
  }
}

export const makeOtlpTracer = (buffer: SpanBuffer): Tracer.Tracer =>
  Tracer.make({
    span: (name, parent, _context, links, startTime, kind) =>
      new OtlpSpan(name, parent, links, startTime, kind, buffer),
    context: (f) => f(),
  });

// --- OTLP JSON encoding --------------------------------------------------------

type OtlpValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number };

export const toOtlpValue = (value: unknown): OtlpValue => {
  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { boolValue: value };
    case "bigint":
      return { intValue: value.toString() };
    case "number":
      return Number.isInteger(value)
        ? { intValue: value.toString() }
        : { doubleValue: value };
    default:
      return { stringValue: JSON.stringify(value) ?? "undefined" };
  }
};

const toOtlpAttributes = (
  attributes: Iterable<readonly [string, unknown]>
): Array<{ key: string; value: OtlpValue }> =>
  Array.from(attributes, ([key, value]) => ({
    key,
    value: toOtlpValue(value),
  }));

const SPAN_KIND: Record<Tracer.SpanKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
};

const spanToOtlp = (span: OtlpSpan) => {
  const status = span.status;
  const ended = status._tag === "Ended";
  const failed = ended && Exit.isFailure(status.exit);
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(Option.isSome(span.parent)
      ? { parentSpanId: span.parent.value.spanId }
      : {}),
    name: span.name,
    kind: SPAN_KIND[span.kind],
    startTimeUnixNano: status.startTime.toString(),
    endTimeUnixNano: ended ? status.endTime.toString() : "0",
    attributes: toOtlpAttributes(span.attributes),
    events: span.events.map((e) => ({
      name: e.name,
      timeUnixNano: e.startTime.toString(),
      attributes: toOtlpAttributes(Object.entries(e.attributes)),
    })),
    status: failed ? { code: 2, message: exitMessage(status.exit) } : { code: 1 },
  };
};

const exitMessage = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.match(exit, {
    onSuccess: () => "",
    onFailure: (cause) => {
      const message = String(cause);
      return message.length > 512 ? message.slice(0, 512) : message;
    },
  });

export const buildOtlpPayload = (
  spans: ReadonlyArray<OtlpSpan>,
  serviceName: string
) => ({
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: serviceName } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "effect-tracer" },
          spans: spans.map(spanToOtlp),
        },
      ],
    },
  ],
});

// --- Export + layer -----------------------------------------------------------

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status: number }>;

/**
 * Drains the buffer and POSTs one OTLP request. Export failures are logged
 * (`tracing.export_failed`) and swallowed — tracing must never fail the app.
 */
export const flushSpans = (
  config: TracingConfig,
  buffer: SpanBuffer,
  fetchFn: FetchLike = (url, init) => fetch(url, init)
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const spans = buffer.spans.splice(0);
    if (spans.length === 0) return Effect.void;
    const dropped = buffer.dropped;
    buffer.dropped = 0;
    const body = JSON.stringify(buildOtlpPayload(spans, config.serviceName));
    return Effect.tryPromise({
      try: () =>
        fetchFn(config.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...config.headers },
          body,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.flatMap((res) =>
        res.ok
          ? dropped > 0
            ? Effect.logWarning("tracing.spans_dropped").pipe(
                Effect.annotateLogs({ dropped })
              )
            : Effect.void
          : Effect.logWarning("tracing.export_failed").pipe(
              Effect.annotateLogs({ status: res.status, spanCount: spans.length })
            )
      ),
      Effect.catchAll((cause) =>
        Effect.logWarning("tracing.export_failed").pipe(
          Effect.annotateLogs({ cause: String(cause), spanCount: spans.length })
        )
      )
    );
  });

/**
 * `Layer.empty` when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset. Otherwise sets
 * the OTLP-buffering tracer and registers a flush finalizer that runs on
 * `runtime.dispose()`.
 */
export const TracingLayer = (
  env: object,
  fetchFn?: FetchLike
): Layer.Layer<never> => {
  const config = readTracingConfig(env);
  if (!config) return Layer.empty;
  const buffer = makeSpanBuffer();
  return Layer.merge(
    Layer.setTracer(makeOtlpTracer(buffer)),
    Layer.scopedDiscard(
      Effect.addFinalizer(() => flushSpans(config, buffer, fetchFn))
    )
  );
};
