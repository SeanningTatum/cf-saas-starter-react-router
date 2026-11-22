import { Effect } from "effect";
import { CLIENT_IP_HEADER } from "@/lib/constants/auth";
import {
  AUTH_API_PATH_PREFIX,
  AUTH_RULE_PATH_PREFIXES,
  HTTP_TOO_MANY_REQUESTS,
  RATE_LIMITED_CODE,
  RATE_LIMITED_MESSAGE,
  RETRY_AFTER_HEADER,
  SHARED_CLIENT_KEY,
  UNLIMITED_METHODS,
} from "@/lib/constants/rate-limit";
import type { RateLimitError } from "@/models/errors/rate-limit";
import { RateLimiter, type RateLimitRule } from "@/services/rate-limit";

export const clientKey = (request: Request): string => {
  const ip = request.headers.get(CLIENT_IP_HEADER)?.trim();
  return ip === undefined || ip === "" ? SHARED_CLIENT_KEY : ip;
};

export const authRuleFor = (request: Request): RateLimitRule | null => {
  if (UNLIMITED_METHODS.includes(request.method.toUpperCase())) return null;
  const path = new URL(request.url).pathname.toLowerCase();
  const named = AUTH_RULE_PATH_PREFIXES.find(({ prefix }) => path.startsWith(prefix));
  if (named !== undefined) return named.rule;
  return path.startsWith(AUTH_API_PATH_PREFIX) ? "authApi" : null;
};

export const guardAuthRequest = (request: Request): Effect.Effect<void, RateLimitError, RateLimiter> => {
  const rule = authRuleFor(request);
  return rule === null
    ? Effect.void
    : Effect.flatMap(RateLimiter, (limiter) => limiter.check(rule, clientKey(request)));
};

export const rateLimitedResponse = (error: RateLimitError): Response =>
  Response.json(
    { code: RATE_LIMITED_CODE, message: RATE_LIMITED_MESSAGE },
    {
      status: HTTP_TOO_MANY_REQUESTS,
      headers: { [RETRY_AFTER_HEADER]: String(error.retryAfterSeconds) },
    }
  );
