export const WORKER_KEY = "worker";
export const ENTRY_KEY = "entry";
export const ROOT_KEY = "root";
export const ROOT_ROUTE_ID = "root";
export const WORKER_LABEL = "Worker upload, gzip";
export const ENTRY_LABEL = "entry.client chunk, gzip";
export const ROOT_LABEL = "root chunk, gzip";
export const routeKey = (id: string, kind: "js" | "css"): string => `route:${id}:${kind}`;
export const routeLabel = (path: string, kind: "js" | "css"): string => `\`${path}\` first-load ${kind === "js" ? "JS" : "CSS"}, gzip`;

export const MANIFEST_PREFIX = "manifest-";
export const CLIENT_ASSETS_DIR = "build/client/assets";
export const ASSET_URL_PREFIX = "/assets/";
export const WORKER_GZIP_PATTERN = /Total Upload:.*?gzip:\s*([\d.]+)\s*(KiB|MiB)/;
export const UNIT_BYTES: Record<string, number> = { KiB: 1024, MiB: 1024 * 1024 };

export const SLOW_LINK_KBITS_PER_SECOND = 1638.4;
export const SLOW_LINK_NAME = "Lighthouse's slow 4G link (1,638.4 kbit/s)";
export const UNMATCHED_PAGES_LEAD = "A page on one side only has no base to compare, so its load time is not counted:";
export const LOAD_FORMULA = "ms = bytes × 8 ÷ 1,638.4";

export const SHIPPED_PREFIXES = ["app/", "workers/"];
export const SHIPPED_FILES = ["package.json", "bun.lock"];
export const NO_SHIPPED_CODE = "No shipped code changed.";
export const SIZE_HEADING = "## Size";
export const COMPARISON_HEADER_PATTERN = /^\|\s*\|\s*base\s*\|\s*This PR\s*\|\s*Change\s*\|\s*$/m;
export const WORKER_ROW_PATTERN = /^\|\s*Worker upload, gzip\s*\|\s*[\d,]+\s*\|\s*[\d,]+\s*\|\s*(?:0|[+-][\d,.]+(?: \([+-][\d.]+%\))?)\s*\|\s*$/m;
export const FENCED_BLOCK_PATTERN = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm;
export const TEST_PATH_PATTERN = /(^|\/)__tests__\/|\.test\.tsx?$/;
export const NO_SHIPPED_PATTERN = /no shipped code changed/i;

export const COLUMN_BASE = "base";
export const COLUMN_HEAD = "This PR";
export const COLUMN_CHANGE = "Change";
export const MISSING_CELL = "—";
export const NEW_CELL = "new";
export const REMOVED_CELL = "removed";
export const UNCHANGED_CELL = "0";

export const CACHE_DIR = "node_modules/.cache/size";
export const WORKTREE_PREFIX = "size-base-";
export const JSON_SUFFIX = ".json";
export const DRY_RUN_ARGS = ["x", "wrangler", "deploy", "--dry-run"];

export const USAGE =
  "usage: bun run size [--base <ref | saved.json>] [--json <file>] [--markdown <file>] [--pr-body]\n" +
  '  --pr-body  print the PR body section: the table and the load-time line, or "No shipped code changed." (needs --base)';
