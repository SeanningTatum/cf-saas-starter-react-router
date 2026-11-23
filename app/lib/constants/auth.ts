const SECONDS_PER_DAY = 60 * 60 * 24;
const SESSION_LIFETIME_DAYS = 7;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const SESSION_EXPIRES_IN_SECONDS = SECONDS_PER_DAY * SESSION_LIFETIME_DAYS;
export const SESSION_UPDATE_AGE_SECONDS = SECONDS_PER_DAY;
export const SESSION_COOKIE_SAME_SITE = "lax";

export const CLIENT_IP_HEADER = "cf-connecting-ip";

export const AUTH_SECRET_MIN_LENGTH = 32;
export const DEV_ONLY_AUTH_SECRET = "dev-only-auth-secret-never-use-outside-local-dev";
export const BETTER_AUTH_BUILT_IN_SECRET = "better-auth-secret-12345678901234567890";
export const PUBLISHED_AUTH_SECRETS: ReadonlyArray<string> = [
  DEV_ONLY_AUTH_SECRET,
  BETTER_AUTH_BUILT_IN_SECRET,
];

export const LOCAL_HTTP_HOSTNAMES: ReadonlyArray<string> = ["localhost", "127.0.0.1"];

export const TRUSTED_ORIGINS_SEPARATOR = ",";

export const WILDCARD_ORIGIN_PATTERN =
  /^(?<origin>(?<scheme>https?):\/\/\*(?:-[a-z0-9-]+)?\.(?<domain>[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?)\/?$/i;

export const SHARED_HOSTING_SUFFIXES: ReadonlyArray<string> = ["workers.dev", "pages.dev"];
