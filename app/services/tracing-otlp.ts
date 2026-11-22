import { Effect, Exit, Option, type Tracer } from "effect";
import {
  FIRST_SERVER_ERROR_STATUS,
  HTTP_STATUS_ATTRIBUTE,
} from "@/lib/constants/error-reporting";
import {
  MAX_LOG_TEXT_LENGTH,
  MAX_SPAN_TEXT_LENGTH,
  REDACTED,
  SENSITIVE_KEY_PATTERN,
  UNPRINTABLE_ATTRIBUTE,
} from "@/lib/constants/redaction";
import { redactWithin } from "@/lib/redact";
import type { OtlpSpan } from "./tracing";

type OtlpValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number };

const printable = (value: unknown): string =>
  Effect.runSync(
    Effect.try(() => JSON.stringify(value) ?? "undefined").pipe(
      Effect.orElseSucceed(() => UNPRINTABLE_ATTRIBUTE)
    )
  );

export const toOtlpValue = (value: unknown): OtlpValue => {
  switch (typeof value) {
    case "string":
      return { stringValue: redactWithin(value, MAX_LOG_TEXT_LENGTH) };
    case "boolean":
      return { boolValue: value };
    case "bigint":
      return { intValue: value.toString() };
    case "number":
      return Number.isInteger(value)
        ? { intValue: value.toString() }
        : { doubleValue: value };
    default:
      return { stringValue: redactWithin(printable(value), MAX_LOG_TEXT_LENGTH) };
  }
};

const toOtlpAttributes = (
  attributes: Iterable<readonly [string, unknown]>
): Array<{ key: string; value: OtlpValue }> =>
  Array.from(attributes, ([key, value]) => ({
    key,
    value: SENSITIVE_KEY_PATTERN.test(key)
      ? { stringValue: REDACTED }
      : toOtlpValue(value),
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
    status: failed
      ? { code: 2, message: exitMessage(status.exit) }
      : otlpStatusForResponse(span.attributes.get(HTTP_STATUS_ATTRIBUTE)),
  };
};

const isServerErrorStatus = (httpStatus: unknown): httpStatus is number =>
  typeof httpStatus === "number" && httpStatus >= FIRST_SERVER_ERROR_STATUS;

export const otlpStatusForResponse = (
  httpStatus: unknown
): { code: 1 } | { code: 2; message: string } =>
  isServerErrorStatus(httpStatus)
    ? { code: 2, message: `HTTP ${httpStatus}` }
    : { code: 1 };

const exitMessage = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.match(exit, {
    onSuccess: () => "",
    onFailure: (cause) => redactWithin(String(cause), MAX_SPAN_TEXT_LENGTH),
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

export const isErrorSpan = (span: OtlpSpan): boolean =>
  (span.status._tag === "Ended" && Exit.isFailure(span.status.exit)) ||
  isServerErrorStatus(span.attributes.get(HTTP_STATUS_ATTRIBUTE));
