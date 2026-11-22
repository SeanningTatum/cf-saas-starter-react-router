import type { Tracer } from "effect";

export const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
export const ALL_ZEROS_PATTERN = /^0+$/;
export const CF_RAY_SAFE_TO_ECHO_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
export const INVALID_TRACEPARENT_VERSION = "ff";
export const REQUEST_ID_RANDOM_BYTES = 16;

export const MAX_BUFFERED_SPANS = 1000;

export const OTLP_SPAN_KIND = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
} as const satisfies Record<Tracer.SpanKind, number>;
