export const RATE_LIMIT_PERIOD_SECONDS = 60;
export const MS_PER_SECOND = 1000;
export const RATE_LIMIT_PERIOD_MS = RATE_LIMIT_PERIOD_SECONDS * MS_PER_SECOND;

export const msLeftInRateLimitWindow = (nowMs: number, periodMs: number = RATE_LIMIT_PERIOD_MS): number =>
  periodMs - (nowMs % periodMs);

export const RATE_LIMIT_BINDINGS = {
  signIn: "AUTH_SIGN_IN_LIMITER",
  signUp: "AUTH_SIGN_UP_LIMITER",
  authApi: "AUTH_API_LIMITER",
  upload: "UPLOAD_LIMITER",
} as const;

export const RATE_LIMIT_REQUESTS_PER_PERIOD: Readonly<Record<keyof typeof RATE_LIMIT_BINDINGS, number>> = {
  signIn: 10,
  signUp: 5,
  authApi: 60,
  upload: 20,
};

export type RateLimitBindingName =(typeof RATE_LIMIT_BINDINGS)[keyof typeof RATE_LIMIT_BINDINGS];

export const AUTH_API_PATH_PREFIX = "/api/auth/";

export const AUTH_RULE_PATH_PREFIXES = [
  { prefix: "/api/auth/sign-in/", rule: "signIn" },
  { prefix: "/api/auth/sign-up/", rule: "signUp" },
] as const;

export const TURNSTILE_GUARDED_RULES: ReadonlyArray<keyof typeof RATE_LIMIT_BINDINGS> = ["signIn", "signUp"];

export const UNLIMITED_METHODS: ReadonlyArray<string> = ["GET", "HEAD", "OPTIONS"];

export const SHARED_CLIENT_KEY = "no-client-ip";

export const PATH_SEPARATOR = "/";
export const REPEATED_SLASHES = /\/{2,}/g;
export const PERCENT_ENCODED_BYTE = /%([0-9a-f]{2})/gi;
export const URL_UNRESERVED_CHARACTER = /^[a-z0-9\-._~]$/i;
export const HEX_RADIX = 16;

export const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;
export const IPV4_SEPARATOR = ".";
export const IPV4_OCTET_MAX = 255;
export const IPV4_OCTET_BITS = 8;
export const IPV6_SEPARATOR = ":";
export const IPV6_ZERO_RUN = "::";
export const IPV6_ZONE_SEPARATOR = "%";
export const IPV6_HEXTET_PATTERN = /^[0-9a-f]{1,4}$/i;
export const IPV6_HEXTET_COUNT = 8;
export const IPV6_MAPPED_IPV4_MARKER = 0xffff;
export const IPV6_MAPPED_IPV4_MARKER_INDEX = 5;
export const IPV6_SUBNET_HEXTETS = 4;
export const IPV6_SUBNET_SUFFIX = "::/64";

export const HTTP_TOO_MANY_REQUESTS = 429;
export const RETRY_AFTER_HEADER = "Retry-After";
export const RATE_LIMITED_CODE = "TOO_MANY_REQUESTS";
export const RATE_LIMITED_MESSAGE = "Too many attempts. Wait a minute, then try again.";
export const UPLOAD_RATE_LIMITED_MESSAGE = "Too many uploads. Wait a minute, then try again.";

export const RATE_LIMITER_SERVICE = "RateLimiter";
export const RATE_LIMITER_FAULT_MESSAGE = "Rate limiter fault; the request goes on unlimited";
export const AUTH_GATE_FAULT_MESSAGE = "Auth rate-limit gate failed; the request goes on unlimited";
