import { Cause, Effect, Option } from "effect";
import {
  FIRST_SERVER_ERROR_STATUS,
  MAX_CAUSE_DEPTH,
  ROUTE_ERROR_RESPONSE_NAME,
  TRPC_ERROR_NAME,
  TRPC_SERVER_FAILURE_CODES,
  UNKNOWN_ERROR_NAME,
} from "@/lib/constants/error-reporting";
import type { ErrorKind, ErrorLevel } from "./adapter";
import { isObject, type Fields } from "./text";

export interface ClassifiedError {
  readonly kind: ErrorKind;
  readonly level: ErrorLevel;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly tag?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const describe = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Effect.runSync(
        Effect.try(() => JSON.stringify(value) ?? String(value)).pipe(
          Effect.orElseSucceed(() => Object.prototype.toString.call(value))
        )
      );

const stackOf = (value: Fields): { stack?: string } => {
  const stack = text(value.stack);
  return stack === undefined ? {} : { stack };
};

const defect = (value: unknown): ClassifiedError =>
  isObject(value) && text(value.message) !== undefined
    ? {
        kind: "defect",
        level: "error",
        name: text(value.name) ?? UNKNOWN_ERROR_NAME,
        message: text(value.message) ?? "",
        ...stackOf(value),
      }
    : {
        kind: "defect",
        level: "error",
        name: UNKNOWN_ERROR_NAME,
        message: describe(value),
      };

const isTrpcError = (value: Fields): value is Fields & { code: string } =>
  value.name === TRPC_ERROR_NAME && typeof value.code === "string";

const fromTrpcError = (
  value: Fields & { code: string },
  depth: number
): ClassifiedError => {
  if (!TRPC_SERVER_FAILURE_CODES.includes(value.code)) {
    return {
      kind: "expected",
      level: "warning",
      name: TRPC_ERROR_NAME,
      message: text(value.message) ?? value.code,
      tag: value.code,
    };
  }
  return value.cause === undefined || depth >= MAX_CAUSE_DEPTH
    ? defect(value)
    : { ...classify(value.cause, depth + 1), level: "error" };
};

const isResponseLike = (
  value: Fields
): value is Fields & { status: number; statusText: string } =>
  typeof value.status === "number" && typeof value.statusText === "string";

const fromResponse = (value: {
  readonly status: number;
  readonly statusText: string;
}): ClassifiedError => {
  const failed = value.status >= FIRST_SERVER_ERROR_STATUS;
  return {
    kind: failed ? "defect" : "expected",
    level: failed ? "error" : "warning",
    name: ROUTE_ERROR_RESPONSE_NAME,
    message: `${value.status} ${value.statusText}`.trim(),
    tag: String(value.status),
  };
};

const fromTagged = (value: Fields, tag: string): ClassifiedError => {
  const own = text(value.message) ?? tag;
  const cause = isObject(value.cause) ? text(value.cause.message) : undefined;
  return {
    kind: "expected",
    level: "error",
    name: tag,
    message: cause === undefined ? own : `${own}: ${cause}`,
    tag,
    ...stackOf(value),
  };
};

const fromCause = (
  cause: Cause.Cause<unknown>,
  depth: number
): ClassifiedError => {
  const died = Cause.dieOption(cause);
  if (Option.isSome(died)) return defect(died.value);
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure) && depth < MAX_CAUSE_DEPTH) {
    return classify(failure.value, depth + 1);
  }
  return {
    kind: "defect",
    level: "error",
    name: "Interrupted",
    message: Cause.pretty(cause),
  };
};

const classify = (error: unknown, depth: number): ClassifiedError => {
  if (Cause.isCause(error)) return fromCause(error, depth);
  if (!isObject(error)) return defect(error);
  if (isTrpcError(error)) return fromTrpcError(error, depth);
  if (isResponseLike(error)) return fromResponse(error);
  if (typeof error._tag === "string") return fromTagged(error, error._tag);
  return defect(error);
};

export const classifyError = (error: unknown): ClassifiedError =>
  classify(error, 0);
