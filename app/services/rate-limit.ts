import { Context, Effect, Layer } from "effect";
import {
  RATE_LIMIT_BINDINGS,
  RATE_LIMIT_PERIOD_SECONDS,
  RATE_LIMITER_FAULT_MESSAGE,
  RATE_LIMITER_SERVICE,
} from "@/lib/constants/rate-limit";
import { RATE_LIMIT_CHECK_SPAN } from "@/lib/constants/spans";
import { RateLimitError } from "@/models/errors/rate-limit";
import { ConfigurationError, ExternalServiceError } from "@/models/errors/repository";
import { CloudflareEnv } from "./cloudflare";

export type RateLimitRule = keyof typeof RATE_LIMIT_BINDINGS;

export class RateLimiter extends Context.Tag("app/RateLimiter")<
  RateLimiter,
  {
    readonly check: (rule: RateLimitRule, key: string) => Effect.Effect<void, RateLimitError>;
  }
>() {}

const bindingOf = (env: Env, rule: RateLimitRule) => {
  const field = RATE_LIMIT_BINDINGS[rule];
  return Effect.fromNullable<RateLimit | undefined>(env[field]).pipe(
    Effect.mapError(() => new ConfigurationError({ service: RATE_LIMITER_SERVICE, field }))
  );
};

const allowed = (env: Env, rule: RateLimitRule, key: string) =>
  Effect.gen(function* () {
    const binding = yield* bindingOf(env, rule);
    const outcome = yield* Effect.tryPromise({
      try: () => binding.limit({ key }),
      catch: (cause) => new ExternalServiceError({ service: RATE_LIMITER_SERVICE, cause }),
    }).pipe(Effect.withSpan(RATE_LIMIT_CHECK_SPAN, { kind: "client", attributes: { "rate_limit.rule": rule } }));
    return outcome.success;
  });

const failOpen = (rule: RateLimitRule) => (fault: ConfigurationError | ExternalServiceError) =>
  Effect.logError(RATE_LIMITER_FAULT_MESSAGE, fault).pipe(
    Effect.annotateLogs({ rule }),
    Effect.as(true)
  );

export const RateLimiterLive: Layer.Layer<RateLimiter, never, CloudflareEnv> = Layer.effect(
  RateLimiter,
  Effect.map(CloudflareEnv, (env) => ({
    check: (rule: RateLimitRule, key: string) =>
      allowed(env, rule, key).pipe(
        Effect.catchTags({
          ConfigurationError: failOpen(rule),
          ExternalServiceError: failOpen(rule),
        }),
        Effect.flatMap((pass) =>
          pass
            ? Effect.void
            : Effect.fail(new RateLimitError({ rule, retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS }))
        )
      ),
  }))
);
