import { AsyncLocalStorage } from "node:async_hooks";
import { Context, Effect, Option } from "effect";
import { setLogContext, setLogSampler } from "./log-format";
import type { SamplingDecision } from "./sampling";
import {
  ALL_ZEROS_PATTERN,
  CF_RAY_SAFE_TO_ECHO_PATTERN,
  INVALID_TRACEPARENT_VERSION,
  REQUEST_ID_RANDOM_BYTES,
  TRACEPARENT_PATTERN,
} from "./constants/tracing";

export interface TraceParent {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

type UrlPathnameWithoutQuery = string;

export interface RequestContext {
  readonly requestId: string;
  readonly method: string;
  readonly path: UrlPathnameWithoutQuery;
  readonly parent?: TraceParent;
  userId?: string;
  readonly sampling?: SamplingDecision;
}

export class CurrentRequest extends Context.Tag("app/CurrentRequest")<
  CurrentRequest,
  RequestContext
>() {}

export const parseTraceparent = (header: string | null | undefined): TraceParent | undefined => {
  if (!header) return undefined;
  const match = TRACEPARENT_PATTERN.exec(header);
  if (!match) return undefined;
  const [, version, traceId, spanId, flags] = match;
  if (
    traceId === undefined ||
    spanId === undefined ||
    flags === undefined ||
    version === INVALID_TRACEPARENT_VERSION ||
    ALL_ZEROS_PATTERN.test(traceId) ||
    ALL_ZEROS_PATTERN.test(spanId)
  ) {
    return undefined;
  }
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
};

export const randomHex = (bytes: number): string => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
};

export const makeRequestContext = (
  request: Request,
  sampling?: SamplingDecision,
): RequestContext => {
  const parent = parseTraceparent(request.headers.get("traceparent"));
  const cfRay = request.headers.get("cf-ray");
  const requestId =
    parent?.traceId ??
    (cfRay !== null && CF_RAY_SAFE_TO_ECHO_PATTERN.test(cfRay)
      ? cfRay
      : randomHex(REQUEST_ID_RANDOM_BYTES));
  return {
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    ...(parent ? { parent } : {}),
    ...(sampling ? { sampling } : {}),
  };
};

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <A>(context: RequestContext, fn: () => A): A =>
  storage.run(context, fn);

export const currentRequestContext = (): RequestContext | undefined => storage.getStore();

export const requestLogFields = (
  context: RequestContext | undefined,
): { requestId?: string; userId?: string } => {
  if (!context) return {};
  return context.userId === undefined
    ? { requestId: context.requestId }
    : { requestId: context.requestId, userId: context.userId };
};

export const setRequestUser = (userId: string | undefined): Effect.Effect<void> =>
  Effect.serviceOption(CurrentRequest).pipe(
    Effect.flatMap((request) => {
      if (userId === undefined || Option.isNone(request)) return Effect.void;
      request.value.userId = userId;
      return Effect.annotateCurrentSpan("user.id", userId);
    }),
  );

setLogContext(() => requestLogFields(currentRequestContext()));
export const keepsLogs = (request: RequestContext | undefined): boolean =>
  request?.sampling?.logs ?? true;

setLogSampler(() => keepsLogs(currentRequestContext()));
