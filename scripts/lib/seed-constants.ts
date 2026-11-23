export const LOCAL_FIXTURE_PASSWORD = "Password123!";

export const MIN_SEED_SECRET_LENGTH = 16;
export const PREVIEW_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;
export const DEFAULT_PREVIEW_SLUG = "shared";
export const DERIVED_PASSWORD_LENGTH = 24;

export const WRANGLER_COMMAND = ["bunx", "wrangler"] as const;
export const D1_BINDING = "DATABASE";
export const SEED_TMP_PREFIX = "seed-preview-";
export const SEED_FILE_NAME = "seed.sql";
export const SQLITE_BUSY = "SQLITE_BUSY";
export const SEED_BUSY_RETRIES = 3;
export const SEED_BUSY_RETRY_DELAY = "500 millis";

export const LOCAL_TARGET_FLAGS = ["--local"] as const;
export const PREVIEW_TARGET_FLAGS = ["--env", "preview", "--remote"] as const;
export const REMOTE_TARGET_FLAGS = ["--remote"] as const;
