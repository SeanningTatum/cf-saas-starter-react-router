export const VALUE_FLAGS = new Set(["--base", "--reports", "--json", "--markdown"]);
export const RUNS = 3;
export const PORT = 4173;
export const HEAD_REF = "HEAD";
export const LIMITS_FILE = ".github/lighthouse-limits.json";
export const WORKTREE_PREFIX = "lighthouse-";
export const LOCAL_HOST = "http://localhost";

export const PUBLIC_PAGES = ["/", "/login", "/sign-up"];
export const SIGNED_IN_PAGES = ["/dashboard"];
export const SIGN_IN_PATH = "/api/auth/sign-in/email";
export const SEEDED_USER = { email: "user@preview.local", password: "Password123!" };

export const METRIC_KEYS = ["score", "lcp", "tbt", "cls"] as const;
export const SCORE_AUDIT = "performance";
export const LCP_AUDIT = "largest-contentful-paint";
export const TBT_AUDIT = "total-blocking-time";
export const CLS_AUDIT = "cumulative-layout-shift";

export const MIGRATE_ARGS = ["run", "db:migrate:local"];
export const SEED_ARGS = ["run", "db:seed"];
export const previewArgs = (port: number): string[] => ["x", "vite", "preview", "--port", String(port), "--strictPort"];
export const LIGHTHOUSE_CLI = "node_modules/lighthouse/cli/index.js";
export const lighthouseArgs = (cli: string, url: string, outputPath: string, cookie: string | undefined): string[] => [
  cli,
  url,
  "--quiet",
  "--only-categories=performance",
  "--output=json",
  "--output=html",
  `--output-path=${outputPath}`,
  "--chrome-flags=--headless=new --no-sandbox",
  "--no-enable-error-reporting",
  ...(cookie === undefined ? [] : [`--extra-headers=${JSON.stringify({ Cookie: cookie })}`]),
];
export const REPORT_JSON_SUFFIX = ".report.json";
export const DEV_VARS_FILE = ".dev.vars";
export const devVars = (port: number, secret: string): string =>
  `BETTER_AUTH_URL=${LOCAL_HOST}:${port}\nBETTER_AUTH_SECRET=${secret}\n`;
export const SECRET_BYTES = 32;
export const SERVER_WAIT_MS = 120000;
export const SERVER_POLL_MS = 1000;

export const HEADING = `## Lighthouse (mobile, median of ${RUNS} runs)`;
export const NO_BREACH = "No page is past a limit.";
export const ARROW = " → ";

export const USAGE =
  "usage: bun run lighthouse [--base <ref>] [--reports <dir>] [--json <file>] [--markdown <file>]\n" +
  "  Builds each ref in a temporary worktree, seeds its local D1, serves the production build and runs Lighthouse (mobile).";
