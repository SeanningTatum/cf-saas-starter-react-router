export const SETUP_ENVIRONMENTS = ["production", "preview", "staging"] as const;
export type SetupEnvironment = (typeof SETUP_ENVIRONMENTS)[number];

export const PRODUCTION_ENVIRONMENT: SetupEnvironment = "production";

export const WRANGLER_ENV_ARGS: Record<SetupEnvironment, string[]> = {
  production: [],
  preview: ["--env", "preview"],
  staging: ["--env", "staging"],
};

export const ENV_SUFFIX: Record<SetupEnvironment, string> = { production: "", preview: "-preview", staging: "-staging" };

export const FLAG_PREFIX = "--";
export const STDIN_MARK = "-";
export const SETUP_ENV_PREFIX = "SETUP_";
export const SKIP_FLAG = "skip";
export const SKIP_ALL = "all";
export const LIST_SEPARATOR = ",";

export const MODE_FLAGS = {
  check: "check",
  yes: "yes",
  provision: "provision",
  security: "security",
  noSecurity: "no-security",
  rotateAuthSecret: "rotate-auth-secret",
  projectName: "project-name",
  r2: "r2",
  noR2: "no-r2",
} as const;

export const BOOLEAN_FLAGS: ReadonlyArray<string> = [
  MODE_FLAGS.check,
  MODE_FLAGS.yes,
  MODE_FLAGS.provision,
  MODE_FLAGS.security,
  MODE_FLAGS.noSecurity,
  MODE_FLAGS.rotateAuthSecret,
  MODE_FLAGS.r2,
  MODE_FLAGS.noR2,
];

export const SETUP_COMMAND = "bun run setup";

export const CLOUDFLARE_TOKENS_URL = "https://dash.cloudflare.com/profile/api-tokens";
export const CLOUDFLARE_ACCOUNT_URL = "https://dash.cloudflare.com/?to=/:account/workers-and-pages";
export const TURNSTILE_DASHBOARD_URL = "https://dash.cloudflare.com/?to=/:account/turnstile";
export const SENTRY_DSN_URL = "https://sentry.io/settings/projects/";
export const POSTHOG_KEYS_URL = "https://app.posthog.com/settings/project#variables";

const AUTH_SECRET_BYTES = 32;
export const GENERATED_SECRET_LENGTH = 64;
export const DUMMY_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
export const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
export const TOKEN_PATTERN = /^\S{20,}$/;
export const STRONG_PROBE_SECRET = "x".repeat(AUTH_SECRET_BYTES * 2);
export const PROBE_URL = "https://probe.example.com";
export const NOT_DEPLOYED_MESSAGE = "isn't currently deployed";
export const REDACTED = "[redacted]";

export const GH_PRODUCTION_ENVIRONMENT = "production";
export const GH_STAGING_ENVIRONMENT = "staging";
export const GH_ENVIRONMENT_ENDPOINT = "repos/{owner}/{repo}/environments";
export const GH_REPO_ENDPOINT = "repos/{owner}/{repo}";
export const GH_VULNERABILITY_ALERTS_ENDPOINT = "repos/{owner}/{repo}/vulnerability-alerts";
export const GH_PRIVATE_REPORTING_ENDPOINT = "repos/{owner}/{repo}/private-vulnerability-reporting";
export const NOT_FOUND_PATTERN = /404|not found/i;

export const SEED_SECRET_NAME = "PREVIEW_SEED_SECRET";
export const ACCOUNT_ID_VARIABLE = "CLOUDFLARE_ACCOUNT_ID";
export const REPO_RULES_ARGS: string[] = ["--apply"];

export const SECURITY_SETTINGS_PATCH = {
  security_and_analysis: {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "enabled" },
  },
};
export const ENABLED = "enabled";

export const GROUP_QUESTIONS: Readonly<Record<string, string>> = {
  deploy: "Set the Cloudflare account id and deploy tokens on GitHub now?",
  auth: "Set the auth URL and trusted origins now?",
  turnstile: "Set Turnstile keys now (bot check on sign-in and sign-up)?",
  errors: "Set an error reporter (Sentry DSN) now?",
  analytics: "Set analytics (PostHog) now?",
};
export const MAX_ATTEMPTS = 3;
export const ALL_ENVIRONMENTS_QUESTION = "Also set preview and staging values?";
export const READINESS_QUESTION = "Run the production-readiness pass now? Anything you skip can be added later by running the same command with that one flag.";
export const AUTO_GENERATED_ENVIRONMENTS: ReadonlyArray<SetupEnvironment> = ["production", "preview"];

export const SECURITY_QUESTION =
  "Apply the security settings now (repo rules, dependency alerts, secret scanning, private reports, production approval)? Needs repo admin.";
export const SECURITY_HINT = `${SETUP_COMMAND} --${MODE_FLAGS.security}`;
export const UNPROTECTED_NOTE = `A deploy token is set. Until the production environment has a required reviewer and deploys only from the default branch, a branch in this repo can read it. Protect it with: ${SECURITY_HINT}`;
