export const SMOKE_ATTEMPTS = 6;
export const SMOKE_DELAY_MS = 10_000;
export const SMOKE_TIMEOUT_MS = 10_000;

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

export const HEALTHY_STATUS = 200;
export const VERSION_OVERRIDES_HEADER = "Cloudflare-Workers-Version-Overrides";
export const WORKER_NAME_RULE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const VERSION_ID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const RELEASE_RULE = /^[A-Za-z0-9._+-]{1,64}$/;
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const SECURE_PROTOCOL = "https:";
export const LOCAL_PROTOCOL = "http:";
export const ROOT_PATH = "/";

export const ENV_SUMMARY = "GITHUB_STEP_SUMMARY";

export const FLAG_URL = "--url";
export const FLAG_RELEASE = "--release";
export const FLAG_WORKER = "--worker";
export const FLAG_VERSION_ID = "--version-id";
export const VALUE_FLAGS: ReadonlySet<string> = new Set([FLAG_URL, FLAG_RELEASE, FLAG_WORKER, FLAG_VERSION_ID]);

const MS_PER_SECOND = 1000;
const DOC = "docs/ci/pipelines.md#smoke-check";

export const USAGE = `usage: smoke-check.ts ${FLAG_URL} <https origin> [${FLAG_RELEASE} <expected release>] [${FLAG_WORKER} <worker name> ${FLAG_VERSION_ID} <version id>]`;
export const ERROR_BAD_URL = "the URL must be an https origin (or http on localhost) with no path, query or credentials";
export const ERROR_HALF_PIN = `${FLAG_WORKER} and ${FLAG_VERSION_ID} go together`;
export const ERROR_BAD_WORKER = "the Worker name must be lower-case letters, digits and hyphens";
export const ERROR_BAD_VERSION = "the version id must be a Worker version UUID";
export const ERROR_PIN_NEEDS_RELEASE = `a pinned version needs ${FLAG_RELEASE}: Cloudflare ignores a pin for a version outside the deployment, and only the release shows which version answered`;
export const ERROR_BAD_RELEASE = "the release must be 1 to 64 letters, digits, dots, hyphens, underscores or plus signs";

export const REASON_NO_ANSWER = "no answer (network error or timeout)";
export const REASON_NOT_JSON = "the body is not the health shape";
export const REASON_DOWN = "the route reports down: the database did not answer";
export const reasonStatus = (status: number): string => `answered HTTP ${status}`;
export const reasonRelease = (expected: string, got: string): string => `answered release ${got}, expected ${expected}: another version served the request`;

export const attemptLine = (attempt: number, attempts: number, reason: string): string => `Smoke check attempt ${attempt} of ${attempts} failed: ${reason}`;
export const passLine = (url: string, release: string): string => `Smoke check passed: ${url} is up, release ${release}`;
export const failLine = (url: string, attempts: number, delayMs: number, reason: string): string =>
  `::error::Smoke check failed: ${url} after ${attempts} attempts ${delayMs / MS_PER_SECOND} seconds apart. Last result: ${reason}. See ${DOC}`;
export const summaryLine = (url: string, verdict: string): string => `- Smoke check of \`${url}\`: ${verdict}`;
