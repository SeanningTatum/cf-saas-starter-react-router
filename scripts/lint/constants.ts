export const SHIPPED_ROOTS = ["app", "workers"] as const;
export const WORKFLOW_SOURCE_DIR = ".claude/workflow-src";
export const LINT_ROOTS = [...SHIPPED_ROOTS, "e2e", "scripts", WORKFLOW_SOURCE_DIR] as const;
export const SKIPPED_DIRS = ["node_modules", ".react-router", "build"] as const;
export const SOURCE_FILE = /\.tsx?$/;
export const TEST_PATH = /(^|\/)__tests__\/|\.test\.tsx?$|\.test-layer\.ts$/;

export const VENDORED_UI = "app/components/ui/";
export const CONSTANTS_DIR = "app/lib/constants/";
export const ROUTE_CONSTANTS_FILE = `${CONSTANTS_DIR}routes.ts`;
export const MAX_FILE_LINES = 400;
export const SIZED_ROOTS = [...SHIPPED_ROOTS, "e2e", "scripts"] as const;
export const WORKFLOW_SOURCE_FILE = /\.js$/;
export const ERRORS_DIR = "app/models/errors";
export const ERROR_MAP_FILE = "app/lib/effect-trpc.ts";
export const MIN_TEST_FILE_CHARS = 40;

export const TEST_MAP_PATH = "scripts/lint/test-map.json";
export const TEST_MAP_ROOTS = ["app", "workers", "scripts", "e2e"] as const;
export const TEST_MAP_KINDS = ["unit", "machine", "procedure", "route", "component", "primitive", "declaration", "spec-helper", "covered-by"] as const;
export const APP_ALIAS = "@/";
export const APP_DIR = "app/";
export const ROUTES_FILE = "app/routes.ts";
export const ROUTER_FILE = "app/trpc/router.ts";
export const LEVELS_FILE = "app/trpc/__tests__/router.test.ts";
export const LEVELS_NAME = "LEVELS";
export const E2E_DIR = "e2e";
export const E2E_SPEC = /\.spec\.ts$/;
export const SMOKE_TAGS = ["@golden", "@error"] as const;
export const SANDBOX_DIR = "app/routes/sandbox";
export const SANDBOX_ISSUE = "#135";

export const BASELINE_PATH = "scripts/lint/baseline.json";
export const LINTER_ENTRY = "scripts/lint/cli.ts";
export const RULES_DIR = "scripts/lint/rules";
export const RULES_PAGE = "docs/agents/lint-rules.md";
export const RULES_START = "<!-- lint-rules:start -->";
export const RULES_END = "<!-- lint-rules:end -->";
export const WRITE_DOCS_COMMAND = "bun run lint:house --write-docs";

export const FIX_LEAD = "Do this instead:";
export const EFFECT_PROMISE_MARKER = "effect-promise-ok:";
export const MAX_DIRECTIVE_CHARS = 160;
export const RULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const FINDING_LINE = /^\S+:\d+ [a-z][a-z0-9-]*: .+\. Do this instead: .+\.( See \S+\.)?$/;

export const GH_TIMEOUT_MS = 4000;
export const SHORT_SHA_LENGTH = 7;

export const USAGE = [
  "usage: bun run lint:house [files…]     check the named files, or the whole repo when none are named",
  "       bun run lint:house --rules       print the rule table",
  "       bun run lint:house --selftest    run every rule's cases",
  "       bun run lint:house --write-docs  rewrite the rule table in docs/agents/lint-rules.md",
  "       bun run lint:house --check-docs  fail when that table is stale",
];
