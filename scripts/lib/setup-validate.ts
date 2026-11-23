import { Effect, Either } from "effect";
import { resolveAuthConfig, type AuthConfigSource } from "../../app/auth/config";
import { TURNSTILE_PUBLISHED_TEST_KEYS } from "../../app/lib/constants/turnstile";
import { parseSentryDsn } from "../../app/lib/error-reporting/adapters/sentry";
import { CLOUDFLARE_ACCOUNT_ID_PATTERN, PROBE_URL, STRONG_PROBE_SECRET, TOKEN_PATTERN } from "./setup-constants";

export type ValueCheck = "auth-secret" | "auth-url" | "origins" | "turnstile-key" | "dsn" | "https-url" | "token" | "account-id" | "text";

const probe = (source: AuthConfigSource): boolean =>
  Either.isRight(
    Effect.runSync(Effect.either(resolveAuthConfig({ BETTER_AUTH_SECRET: STRONG_PROBE_SECRET, BETTER_AUTH_URL: PROBE_URL, ...source }, { dev: false }))),
  );

const isHttps = (value: string): boolean => URL.canParse(value) && new URL(value).protocol === "https:";

const CHECKS: Record<ValueCheck, (value: string) => string | undefined> = {
  "auth-secret": (value) => (probe({ BETTER_AUTH_SECRET: value }) ? undefined : "must be at least 32 characters and not a published value"),
  "auth-url": (value) => (probe({ BETTER_AUTH_URL: value }) ? undefined : "must be an https origin, or http://localhost or http://127.0.0.1"),
  origins: (value) => (probe({ AUTH_TRUSTED_ORIGINS: value }) ? undefined : "must be a comma-separated list of bare origins or wildcard origins you own"),
  "turnstile-key": (value) => (TURNSTILE_PUBLISHED_TEST_KEYS.includes(value) ? "is a published Cloudflare test key; production refuses it" : undefined),
  dsn: (value) => (parseSentryDsn(value) === undefined ? "must be an https Sentry DSN" : undefined),
  "https-url": (value) => (isHttps(value) ? undefined : "must be an https URL"),
  token: (value) => (TOKEN_PATTERN.test(value) ? undefined : "must be one token of at least 20 characters with no spaces"),
  "account-id": (value) => (CLOUDFLARE_ACCOUNT_ID_PATTERN.test(value) ? undefined : "must be 32 lowercase hex characters"),
  text: (value) => (value.trim() === "" ? "must not be empty" : undefined),
};

export const checkValue = (check: ValueCheck, value: string): string | undefined => CHECKS[check](value);

export const TURNSTILE_PAIR_PROBLEM = "the Turnstile site key and secret key go in together: with only one set, auth refuses to start";
