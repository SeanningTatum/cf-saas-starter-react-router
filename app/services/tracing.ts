import { Clock, Context, Effect, type Exit, Layer, Option, Tracer } from "effect";
import {
  FORCED_TRACE_EXPORT_WINDOW_LIMIT,
  FORCED_TRACE_EXPORT_WINDOW_MS,
} from "@/lib/constants/redaction";
import {
  makeReportBudget,
  type ReportBudget,
} from "@/lib/error-reporting/report-budget";
import { randomHex, type RequestContext } from "@/lib/request-context";
import { MAX_BUFFERED_SPANS } from "@/lib/constants/tracing";
import { buildOtlpPayload, isErrorSpan } from "./tracing-otlp";

export interface TracingConfig {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly serviceName: string;
}

const readEnvString = (env: object, key: string): string | undefined => {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

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

interface SpanEvent {
  readonly name: string;
  readonly startTime: bigint;
  readonly attributes: Record<string, unknown>;
}

export { MAX_BUFFERED_SPANS };

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

export const makeOtlpTracer = (
  buffer: SpanBuffer,
  request?: RequestContext
): Tracer.Tracer =>
  Tracer.make({
    span: (name, parent, _context, links, startTime, kind) => {
      const span = new OtlpSpan(name, parent, links, startTime, kind, buffer);
      if (request) {
        span.attribute("request.id", request.requestId);
        if (request.userId !== undefined) {
          span.attribute("user.id", request.userId);
        }
      }
      return span;
    },
    context: (f) => f(),
  });

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status: number }>;

const forcedExportBudget = makeReportBudget({
  limit: FORCED_TRACE_EXPORT_WINDOW_LIMIT,
  windowMs: FORCED_TRACE_EXPORT_WINDOW_MS,
});

export const flushSpans = (
  config: TracingConfig,
  buffer: SpanBuffer,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
  sampled: boolean = true,
  forced: ReportBudget = forcedExportBudget
): Effect.Effect<void> =>
  Effect.flatMap(Clock.currentTimeMillis, (ms) => {
    const spans = buffer.spans.splice(0);
    if (spans.length === 0) return Effect.void;
    if (!sampled && !(spans.some(isErrorSpan) && forced.take(ms))) {
      buffer.dropped = 0;
      return Effect.void;
    }
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
              Effect.annotateLogs({
                status: res.status,
                spanCount: spans.length,
                dropped,
              })
            )
      ),
      Effect.catchAll((cause) =>
        Effect.logWarning("tracing.export_failed").pipe(
          Effect.annotateLogs({
            cause: String(cause),
            spanCount: spans.length,
            dropped,
          })
        )
      )
    );
  });

export const TracingLayer = (
  env: object,
  fetchFn?: FetchLike,
  request?: RequestContext
): Layer.Layer<never> => {
  const config = readTracingConfig(env);
  if (!config) return Layer.empty;
  const buffer = makeSpanBuffer();
  return Layer.merge(
    Layer.setTracer(makeOtlpTracer(buffer, request)),
    Layer.scopedDiscard(
      Effect.addFinalizer(() =>
        flushSpans(config, buffer, fetchFn, request?.sampling?.traces ?? true)
      )
    )
  );
};
