export const FULL_RUN_TRIGGERS = [
  { match: "scripts/verify.sh", reason: "the gate runner" },
  { match: "scripts/verify-changed.ts", reason: "the gate runner" },
  { match: "scripts/lib/verify-plan*.ts", reason: "the gate runner" },
  { match: "scripts/check-non-negotiables.ts", reason: "a gate script" },
  { match: "scripts/migration-check.ts", reason: "a gate script" },
  { match: "scripts/lib/migration-*.ts", reason: "a gate script" },
  { match: "scripts/harness-check.sh", reason: "a gate script" },
  { match: "scripts/workflows.ts", reason: "a gate script" },
  { match: "scripts/repo-rules.ts", reason: "a gate script" },
  { match: "scripts/lib/repo-rules-*.ts", reason: "a gate script" },
  { match: "scripts/secret-scan.ts", reason: "a gate script" },
  { match: "scripts/package-audit.ts", reason: "a gate script" },
  { match: "scripts/lint/**", reason: "the house linter, its rules, map or baseline" },
  { match: "docs/agents/lint-rules.md", reason: "a page the harness gate checks" },
  { match: "package.json", reason: "a config file" },
  { match: "tsconfig*.json", reason: "a config file" },
  { match: "vite.config.ts", reason: "a config file" },
  { match: "vitest.config.ts", reason: "a config file" },
  { match: "playwright.config.ts", reason: "a config file" },
  { match: "react-router.config.ts", reason: "a config file" },
  { match: "drizzle.config.ts", reason: "a config file" },
  { match: "wrangler.jsonc", reason: "a config file" },
  { match: "worker-configuration.d.ts", reason: "a config file" },
  { match: ".bun-version", reason: "a config file" },
  { match: "bun.lock", reason: "the lockfile" },
  { match: "bun.lockb", reason: "the lockfile" },
  { match: ".github/**", reason: "a CI workflow or repo rule" },
  { match: ".claude/**", reason: "a harness file the harness gate checks" },
  { match: ".kimi-code/**", reason: "a harness file the harness gate checks" },
  { match: "AGENTS.md", reason: "a harness file the harness gate checks" },
  { match: "CLAUDE.md", reason: "a harness file the harness gate checks" },
  { match: "drizzle/**", reason: "a migration, which the migrations gate reads" },
  { match: "app/db/schema.ts", reason: "the schema, which the migrations gate reads" },
] as const;

export const GATE = { typecheck: "typecheck", lint: "non-negotiables", test: "test", e2e: "e2e" } as const;

export const COMMAND = {
  typecheck: "bun run typecheck",
  lint: "bun run lint:house",
  test: "bunx vitest related --run --passWithNoTests",
  e2e: "CI=1 bun run test:e2e",
} as const;

export const MODULE_FILE = /\.(tsx?|jsx?|json)$/;

export const SKIP_REASON = {
  noCode: "no .ts or .tsx file changed",
  noModule: "no .ts, .tsx, .js or .json file changed, so no test imports one",
  noSpec: "no changed file maps to an e2e spec (scripts/lint/test-map.json, the route table, or a spec that imports it)",
} as const;

export const UNSAFE_PATH = /[|\n\r]/;
export const UNSAFE_PATH_REASON = "a changed path holds a | or a line break, which the plan format cannot carry";
export const NO_MAP_REASON = "scripts/lint/test-map.json does not parse, so the e2e specs cannot be chosen";
export const NO_BASE_REASON = "no base branch found";
export const PATHS_SPEC_SUFFIX = ".paths.spec.ts";
export const MACHINE_SUFFIX = /\.machine\.tsx?$/;
export const SHELL_QUOTE = "'";
export const SHELL_QUOTE_ESCAPED = "'\\''";
export const FIELD = "|";
export const LINE = { base: "base", full: "full", run: "run", skip: "skip" } as const;
export const GIT_DIFF = ["diff", "--name-only", "--no-renames", "-z"] as const;
export const GIT_UNTRACKED = ["ls-files", "--others", "--exclude-standard", "-z"] as const;
export const NUL = "\u0000";
export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const USAGE = "usage: bun scripts/verify-changed.ts [base]   print the lean gate plan for the change against base";
