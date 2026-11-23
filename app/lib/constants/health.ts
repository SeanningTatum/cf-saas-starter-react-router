export const HEALTHZ_PATH = "/healthz";

export const HEALTH_UP = "up";
export const HEALTH_DOWN = "down";

export const HEALTHZ_UP_STATUS = 200;
export const HEALTHZ_DOWN_STATUS = 503;
export const HEALTHZ_WRONG_METHOD_STATUS = 405;
export const HEALTHZ_ALLOWED_METHODS = "GET, HEAD";

export const HEALTHZ_CHECK_TTL_MS = 5_000;
export const HEALTHZ_UP_ATTRIBUTE = "healthz.up";

export const HEALTHZ_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
