export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_PROVIDER = "cloudflare-turnstile";
export const TURNSTILE_TOKEN_HEADER = "x-captcha-response";
export const TURNSTILE_PROTECTED_ENDPOINTS = ["/sign-up/email", "/sign-in/email"];

export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA"; // secret-scan: allow secret-assignment -- public test secret from Cloudflare docs, always passes
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export const TURNSTILE_ALWAYS_PASS_TEST_KEYS = {
  siteKey: TURNSTILE_TEST_SITE_KEY,
  secretKey: TURNSTILE_TEST_SECRET_KEY,
} as const;

export const TURNSTILE_TEST_ALWAYS_FAIL_SITE_KEY = "2x00000000000000000000AB";
export const TURNSTILE_TEST_ALWAYS_FAIL_SECRET_KEY = "2x0000000000000000000000000000000AA"; // secret-scan: allow secret-assignment -- public test secret from Cloudflare docs, always fails

export const TURNSTILE_PUBLISHED_TEST_KEYS: ReadonlyArray<string> = [
  TURNSTILE_TEST_SITE_KEY,
  "1x00000000000000000000BB",
  TURNSTILE_TEST_ALWAYS_FAIL_SITE_KEY,
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_ALWAYS_FAIL_SECRET_KEY,
  "3x0000000000000000000000000000000AA",
];
