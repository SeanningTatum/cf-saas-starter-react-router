export const RATE_LIMIT_PERIOD_SECONDS = 60;

export const RATE_LIMIT_BINDINGS = {
  signIn: "AUTH_SIGN_IN_LIMITER",
  signUp: "AUTH_SIGN_UP_LIMITER",
  authApi: "AUTH_API_LIMITER",
  upload: "UPLOAD_LIMITER",
} as const;

export type RateLimitBindingName = (typeof RATE_LIMIT_BINDINGS)[keyof typeof RATE_LIMIT_BINDINGS];

export const AUTH_API_PATH_PREFIX = "/api/auth/";

export const AUTH_RULE_PATH_PREFIXES = [
  { prefix: "/api/auth/sign-in/", rule: "signIn" },
  { prefix: "/api/auth/sign-up/", rule: "signUp" },
] as const;

export const UNLIMITED_METHODS: ReadonlyArray<string> = ["GET", "HEAD", "OPTIONS"];

export const SHARED_CLIENT_KEY = "no-client-ip";

export const HTTP_TOO_MANY_REQUESTS = 429;
export const RETRY_AFTER_HEADER = "Retry-After";
export const RATE_LIMITED_CODE = "TOO_MANY_REQUESTS";
export const RATE_LIMITED_MESSAGE = "Too many attempts. Wait a minute, then try again.";
export const UPLOAD_RATE_LIMITED_MESSAGE = "Too many uploads. Wait a minute, then try again.";

export const RATE_LIMITER_SERVICE = "RateLimiter";
export const RATE_LIMITER_FAULT_MESSAGE = "Rate limiter fault; the request goes on unlimited";
export const AUTH_GATE_FAULT_MESSAGE = "Auth rate-limit gate failed; the request goes on unlimited";
