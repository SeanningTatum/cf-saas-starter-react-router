export const SEEDED_PASSWORD = "Password123!";

export const SEEDED_LOGINS = {
  admin: "admin@preview.local",
  user: "user@preview.local",
  banned: "banned@preview.local",
} as const;

export const PAGE_PATHS = {
  home: "/",
  login: "/login",
  signUp: "/sign-up",
  dashboard: "/dashboard",
} as const;

export const API_PATHS = {
  prefix: "/api/",
  signIn: "/api/auth/sign-in/email",
  signUp: "/api/auth/sign-up/email",
  signOut: "/api/auth/sign-out",
  getSession: "/api/auth/get-session",
  removeUser: "/api/auth/admin/remove-user",
} as const;

export const CLIENT_IPS = {
  auth: "203.0.113.10",
  "auth-turnstile": "203.0.113.11",
  "auth-rate-limit": "198.51.100.10",
  "security-headers": "203.0.113.12",
  "file-upload": "203.0.113.13",
  "admin-user-toasts": "203.0.113.14",
} as const;

export type SpecFile = keyof typeof CLIENT_IPS;

export const IPV6_DOCUMENTATION_PREFIX = "2001:db8";
export const IPV6_GROUP_RADIX = 16;
export const IPV6_HOST_SUFFIX = "::1";

export const SESSION_COOKIE_FRAGMENT = "session_token";
export const SET_COOKIE_HEADER = "set-cookie";

export const TURNSTILE_MISSING_TOKEN_CODE = "MISSING_RESPONSE";
export const EMPTY_TURNSTILE_TOKEN = "";
export const TURNSTILE_STUB_WIDGET_ID = "e2e-stub-widget";
export const JAVASCRIPT_CONTENT_TYPE = "application/javascript";

export const TURNSTILE_WIDGET_TEST_ID = "turnstile-widget";
export const TURNSTILE_STATE_ATTRIBUTE = "data-turnstile-state";
export const TURNSTILE_PROBLEM_TEST_ID = "turnstile-problem";
export const TURNSTILE_RETRY_TEST_ID = "turnstile-retry";

export const HTTP_STATUS = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
} as const;

export const TIMEOUTS_MS = {
  oneLook: 1_000,
  firstHydration: 15_000,
  hydrationAfterReload: 30_000,
  turnstileReady: 30_000,
  rateLimitWindowWait: 25_000,
} as const;

export const RATE_LIMIT_WINDOW_MARGIN_SECONDS = 20;
