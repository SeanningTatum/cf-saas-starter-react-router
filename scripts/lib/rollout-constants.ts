export const ROLLOUT_STEPS: readonly number[] = [10, 50, 100];
export const FULL_TRAFFIC = 100;
export const SOAK_MS = 60_000;

export const WRANGLER_COMMAND: readonly string[] = ["bunx", "wrangler"];
export const UPLOAD_TIMEOUT_MS = 300_000;
export const DEPLOY_TIMEOUT_MS = 120_000;
export const STATUS_TIMEOUT_MS = 60_000;
export const TIMEOUT_CODE = "ETIMEDOUT";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const SUCCESS_STATUS = 0;

export const ENV_RELEASE = "RELEASE_VERSION";
export const ENV_SHA = "DEPLOY_SHA";
export const ENV_URL = "PRODUCTION_URL";
export const ENV_SUMMARY = "GITHUB_STEP_SUMMARY";
export const ENV_OUTPUT = "GITHUB_OUTPUT";
export const PRODUCTION_ENVIRONMENT = "production";

export const VERSION_ID_LINE = /Worker Version ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
export const NO_DEPLOYMENTS_MARKER = "has no deployments";
export const OPEN_BRACE = "{";
export const CLOSE_BRACE = "}";
export const SHA_PREFIX_LENGTH = 7;

export const OUTCOME_PROMOTED = "promoted";
export const OUTCOME_ROLLED_BACK = "rolled-back";
export const OUTCOME_ROLLBACK_FAILED = "rollback-failed";
export const OUTCOME_FAILED = "failed";

const DOC = "docs/ci/rollback.md#automatic-rollback";
const MS_PER_SECOND = 1000;

export const SUMMARY_HEADING = "### Production rollout";

export const ERROR_NO_RELEASE = `::error::${ENV_RELEASE} is not set or not a valid release, so nothing was uploaded.`;
export const ERROR_NO_NAME = "::error::wrangler.jsonc has no Worker name, so nothing was uploaded.";
export const ERROR_STATUS = `::error::Could not read the current deployment, so nothing was uploaded. See ${DOC}`;
export const ERROR_UPLOAD = `::error::The new version did not upload, so production still runs the version it ran. See ${DOC}`;
export const ERROR_NO_VERSION_ID = `::error::The upload printed no Worker Version ID (has the wrangler output changed?), so nothing was deployed. See ${DOC}`;
export const WARNING_NO_URL = `::warning::The ${ENV_URL} variable is not set, so the new version goes to 100% at once with no smoke check and no automatic rollback. See ${DOC}`;
export const WARNING_FIRST_DEPLOY = `::warning::The Worker has no deployment yet, so the first version goes to 100% at once; a failed smoke check cannot roll back. See ${DOC}`;

export const uploadedLine = (versionId: string): string => `Uploaded version ${versionId}`;
export const stepLine = (percent: number, versionId: string): string => `Sending ${percent}% of traffic to ${versionId}`;
export const soakLine = (ms: number): string => `Waiting ${ms / MS_PER_SECOND} seconds before the smoke check`;
export const deployFailed = (percent: number): string => `::error::Could not move ${percent}% of traffic to the new version. Rolling back. See ${DOC}`;
export const rolledBackLine = (percent: number, previous: string): string =>
  `::error::The smoke check failed at ${percent}% of traffic, so all traffic went back to version ${previous}. Production runs the old code; the database keeps any migration this deploy ran. See ${DOC}`;
export const rollbackFailedLine = (previous: string): string =>
  `::error::The rollback to version ${previous} failed. Production may still send traffic to the new version: run \`bunx wrangler versions deploy ${previous}@100% -y\` now. See ${DOC}`;
export const firstDeployFailedLine = (versionId: string): string =>
  `::error::The smoke check failed on the first deployment (${versionId}) and there is no earlier version to go back to. See ${DOC}`;
export const promotedLine = (versionId: string, release: string): string => `Version ${versionId} (release ${release}) serves 100% of traffic.`;
export const versionMessage = (release: string, sha: string): string => `release ${release} (${sha})`;
export const stepMessage = (release: string, percent: number): string => `rollout ${release} at ${percent}%`;
export const rollbackMessage = (release: string, percent: number): string => `automatic rollback of ${release}: smoke check failed at ${percent}%`;

export const summaryOutcome = (outcome: string): string => `- Outcome: **${outcome}**`;
export const summaryVersions = (next: string, previous: string | undefined): string =>
  `- New version: \`${next}\`; previous: ${previous ? `\`${previous}\`` : "none"}`;
export const summaryStep = (percent: number, passed: boolean): string => `- ${percent}%: smoke check ${passed ? "passed" : "failed"}`;
export const summaryAt = (percent: number): string => `- Failed at: ${percent}% of traffic`;
