import { Effect } from "effect";
import {
  AUTH_SECRET_MIN_LENGTH,
  DEV_ONLY_AUTH_SECRET,
  LOCAL_HTTP_HOSTNAMES,
  PUBLISHED_AUTH_SECRETS,
  SHARED_HOSTING_SUFFIXES,
  TRUSTED_ORIGINS_SEPARATOR,
  WILDCARD_ORIGIN_PATTERN,
} from "@/lib/constants/auth";
import { ConfigurationError } from "@/models/errors/repository";

export interface AuthConfig {
  readonly secret: string;
  readonly baseURL: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly secureCookies: boolean;
}

export interface AuthConfigSource {
  readonly BETTER_AUTH_SECRET?: string;
  readonly BETTER_AUTH_URL?: string;
  readonly AUTH_TRUSTED_ORIGINS?: string;
}

export interface AuthRuntimeOptions {
  readonly dev: boolean;
  readonly requestOrigin?: string;
}

type AuthConfigField = keyof AuthConfigSource;

const configError = (field: AuthConfigField) =>
  new ConfigurationError({ service: "BetterAuth", field });

const nonBlank = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value.trim();

const httpURL = (value: string, field: AuthConfigField): Effect.Effect<URL, ConfigurationError> =>
  Effect.try({
    try: () => new URL(value),
    catch: () => configError(field),
  }).pipe(
    Effect.filterOrFail(
      (url) => url.protocol === "https:" || url.protocol === "http:",
      () => configError(field)
    )
  );

const isBareOrigin = (url: URL) => new URL(url.origin).href === url.href;

const exactOrigin = (entry: string) =>
  httpURL(entry, "AUTH_TRUSTED_ORIGINS").pipe(
    Effect.filterOrFail(isBareOrigin, () => configError("AUTH_TRUSTED_ORIGINS")),
    Effect.map((url) => url.origin)
  );

const wildcardOrigin = (entry: string, dev: boolean): Effect.Effect<string, ConfigurationError> => {
  const { origin, scheme, domain } = WILDCARD_ORIGIN_PATTERN.exec(entry)?.groups ?? {};
  const schemeAllowed = dev || scheme?.toLowerCase() === "https";
  const ownsDomain = domain !== undefined && !SHARED_HOSTING_SUFFIXES.includes(domain.toLowerCase());
  return origin !== undefined && schemeAllowed && ownsDomain
    ? Effect.succeed(origin.toLowerCase())
    : Effect.fail(configError("AUTH_TRUSTED_ORIGINS"));
};

const parseTrustedOrigins = (
  raw: string | undefined,
  dev: boolean
): Effect.Effect<ReadonlyArray<string>, ConfigurationError> =>
  Effect.forEach(
    (raw ?? "")
      .split(TRUSTED_ORIGINS_SEPARATOR)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
    (entry) => (entry.includes("*") ? wildcardOrigin(entry, dev) : exactOrigin(entry))
  );

const configuredBaseURL = (env: AuthConfigSource) => {
  const value = nonBlank(env.BETTER_AUTH_URL);
  return value === undefined
    ? Effect.fail(configError("BETTER_AUTH_URL"))
    : httpURL(value, "BETTER_AUTH_URL");
};

const keepsCookiesSecure = (url: URL) =>
  url.protocol === "https:" || LOCAL_HTTP_HOSTNAMES.includes(url.hostname);

const deployedBaseURL = (env: AuthConfigSource) =>
  configuredBaseURL(env).pipe(
    Effect.filterOrFail(keepsCookiesSecure, () => configError("BETTER_AUTH_URL")),
    Effect.map((url) => url.origin)
  );

const devBaseURL = (env: AuthConfigSource, options: AuthRuntimeOptions) => {
  const requestOrigin = nonBlank(options.requestOrigin);
  return requestOrigin === undefined
    ? configuredBaseURL(env).pipe(Effect.map((url) => url.origin))
    : Effect.succeed(requestOrigin);
};

const setSecret = (env: AuthConfigSource): string | undefined =>
  nonBlank(env.BETTER_AUTH_SECRET) === undefined ? undefined : env.BETTER_AUTH_SECRET;

const isStrongSecret = (secret: string) =>
  secret.length >= AUTH_SECRET_MIN_LENGTH && !PUBLISHED_AUTH_SECRETS.includes(secret);

const deployedSecret = (env: AuthConfigSource) => {
  const secret = setSecret(env);
  return secret !== undefined && isStrongSecret(secret)
    ? Effect.succeed(secret)
    : Effect.fail(configError("BETTER_AUTH_SECRET"));
};

const devSecret = (env: AuthConfigSource) => Effect.succeed(setSecret(env) ?? DEV_ONLY_AUTH_SECRET);

export const resolveAuthConfig = (
  env: AuthConfigSource,
  options: AuthRuntimeOptions
): Effect.Effect<AuthConfig, ConfigurationError> =>
  Effect.gen(function* () {
    const baseURL = yield* options.dev ? devBaseURL(env, options) : deployedBaseURL(env);
    const secret = yield* options.dev ? devSecret(env) : deployedSecret(env);
    const trustedOrigins = yield* parseTrustedOrigins(env.AUTH_TRUSTED_ORIGINS, options.dev);
    return {
      secret,
      baseURL,
      trustedOrigins,
      secureCookies: baseURL.startsWith("https://"),
    };
  });
