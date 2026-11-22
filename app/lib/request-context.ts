import { AsyncLocalStorage } from "node:async_hooks";
import { Context, Effect, Option } from "effect";
import { setLogContext } from "./log-format";

/**
 * One id and the signed-in user for every log line and span of a request.
 *
 * Server-only: it imports `node:async_hooks` (a Workers API under the
 * `nodejs_compat` flag). Never import it from a component, from `root.tsx`'s
 * client code or from `log-format.ts`, which a client bundle may load.
 *
 * Two paths read it:
 * - Effect code (`Effect.log*`, spans) reads `CurrentRequest` out of the
 *   per-request runtime's context. That cannot mix two requests up.
 * - Plain promise code (`loggers.x.info(...)`) has no context argument, so
 *   `emitLog` reads the async-local store that `workers/app.ts` opens around
 *   the request with `runWithRequestContext`.
 *
 * The id is for finding a request's logs and spans, nothing more. A caller can
 * choose it (it comes from `traceparent`), so never use it to decide access.
 */

export interface TraceParent {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

export interface RequestContext {
  readonly requestId: string;
  readonly method: string;
  /** URL pathname only, no query string. */
  readonly path: string;
  /** A valid incoming `traceparent`. */
  readonly parent?: TraceParent;
  /** Set once, when the session resolves. */
  userId?: string;
}

/** The request, as a service in the per-request runtime. */
export class CurrentRequest extends Context.Tag("app/CurrentRequest")<
  CurrentRequest,
  RequestContext
>() {}

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ALL_ZERO = /^0+$/;
// `cf-ray` is set by Cloudflare's edge, but a request that reaches the worker
// some other way (local dev, a test) can carry any value. Only this shape may
// reach a log line or a response header.
const CF_RAY = /^[A-Za-z0-9-]{1,64}$/;

/**
 * W3C trace context: `00-<32 hex>-<16 hex>-<2 hex>`, lower-case hex, neither
 * id all zeros, version not `ff`. Anything else is undefined.
 */
export const parseTraceparent = (
  header: string | null | undefined
): TraceParent | undefined => {
  if (!header) return undefined;
  const match = TRACEPARENT.exec(header);
  if (!match) return undefined;
  const [, version, traceId, spanId, flags] = match;
  if (version === "ff" || ALL_ZERO.test(traceId) || ALL_ZERO.test(spanId)) {
    return undefined;
  }
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
};

/** `bytes` random bytes from crypto.getRandomValues, as hex. */
export const randomHex = (bytes: number): string => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * id = traceparent's trace id, else a well-formed `cf-ray`, else
 * randomHex(16).
 */
export const makeRequestContext = (request: Request): RequestContext => {
  const parent = parseTraceparent(request.headers.get("traceparent"));
  const cfRay = request.headers.get("cf-ray");
  const requestId =
    parent?.traceId ??
    (cfRay !== null && CF_RAY.test(cfRay) ? cfRay : randomHex(16));
  return {
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    ...(parent ? { parent } : {}),
  };
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` as the async-local store. */
export const runWithRequestContext = <A>(
  context: RequestContext,
  fn: () => A
): A => storage.run(context, fn);

/** The store's request, or undefined outside a request. */
export const currentRequestContext = (): RequestContext | undefined =>
  storage.getStore();

/**
 * `{ requestId, userId? }` for a log line; `{}` for undefined. The `userId`
 * key is absent when no one is signed in.
 */
export const requestLogFields = (
  context: RequestContext | undefined
): { requestId?: string; userId?: string } => {
  if (!context) return {};
  return context.userId === undefined
    ? { requestId: context.requestId }
    : { requestId: context.requestId, userId: context.userId };
};

/**
 * Records the signed-in user on the request (the service in context) and on
 * the current span as `user.id`. No-op when there is no `CurrentRequest` or
 * no id.
 */
export const setRequestUser = (
  userId: string | undefined
): Effect.Effect<void> =>
  Effect.serviceOption(CurrentRequest).pipe(
    Effect.flatMap((request) => {
      if (userId === undefined || Option.isNone(request)) return Effect.void;
      request.value.userId = userId;
      return Effect.annotateCurrentSpan("user.id", userId);
    })
  );

// The module's one import-time side effect: hand the async-local store to the
// log sink, so every plain `loggers.x.info(...)` line inside a request carries
// its id. `log-format.ts` cannot import this module itself (it must stay free
// of Node imports), hence the registration from this side.
setLogContext(() => requestLogFields(currentRequestContext()));
