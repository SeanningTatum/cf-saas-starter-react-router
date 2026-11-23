export const LOCAL_STATE_DIR = ".wrangler/state/v3";
export const WIPED_STATE_DIRS = ["d1", "r2"] as const;
export const LSOF_BIN = "lsof";
export const BUN_RUN_MIGRATE = ["run", "db:migrate:local"] as const;
export const SEED_SCRIPT = "scripts/seed-preview.ts";
export const PID_PATTERN = /^\d+$/;
export const LSOF_NO_HOLDER_CODE = 1;
