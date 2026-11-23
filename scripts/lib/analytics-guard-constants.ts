export const LOCAL_ENV_FILES = [".dev.vars", ".env"] as const;
export const ANALYTICS_PROVIDER_LINES = /^[ \t]*ANALYTICS_PROVIDER[ \t]*=[ \t]*["']?([^"'\s#]*)/gm;
export const REAL_ANALYTICS_PROVIDER = "posthog";
export const UNREADABLE_PROVIDER = "unknown";
