import type { Outcome } from "../repo-rules";
import {
  ENABLED,
  GH_ENVIRONMENT_ENDPOINT,
  GH_PRIVATE_REPORTING_ENDPOINT,
  GH_PRODUCTION_ENVIRONMENT,
  GH_REPO_ENDPOINT,
  GH_VULNERABILITY_ALERTS_ENDPOINT,
  REPO_RULES_ARGS,
  SECURITY_SETTINGS_PATCH,
} from "./setup-constants";
import { failure, succeeded, type Runner } from "./setup-run";

export type SecurityStatus = "applied" | "already" | "left";

export interface SecurityResult {
  readonly id: string;
  readonly label: string;
  readonly status: SecurityStatus;
  readonly detail: string;
}

export interface SecurityContext {
  readonly run: Runner;
  readonly applyRules: (argv: string[]) => Outcome;
}

export interface AuthSecretFacts {
  readonly authSecretsSet: ReadonlyArray<string>;
  readonly authSecretsKept: boolean;
}

const result = (id: string, label: string, status: SecurityStatus, detail: string): SecurityResult => ({ id, label, status, detail });

const parseObject = (text: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : {};
  } catch {
    return {};
  }
};

const nested = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (current, key) => (typeof current === "object" && current !== null && key in current ? Object.fromEntries(Object.entries(current))[key] : undefined),
    value,
  );

const dependencyAlerts = ({ run }: SecurityContext): SecurityResult => {
  const label = "Dependency alerts";
  if (succeeded(run("gh", ["api", GH_VULNERABILITY_ALERTS_ENDPOINT]))) return result("dependency-alerts", label, "already", "on");
  const put = run("gh", ["api", "-X", "PUT", GH_VULNERABILITY_ALERTS_ENDPOINT]);
  return succeeded(put)
    ? result("dependency-alerts", label, "applied", "turned on")
    : result("dependency-alerts", label, "left", `needs repo admin: Settings, Code security, Dependabot alerts (${failure(put)})`);
};

const secretScanning = ({ run }: SecurityContext): SecurityResult => {
  const label = "Secret scanning and push protection";
  const read = run("gh", ["api", GH_REPO_ENDPOINT]);
  const settings = parseObject(read.stdout);
  const scanning = nested(settings, "security_and_analysis", "secret_scanning", "status");
  const push = nested(settings, "security_and_analysis", "secret_scanning_push_protection", "status");
  if (succeeded(read) && scanning === ENABLED && push === ENABLED) return result("secret-scanning", label, "already", "on");
  const patch = run("gh", ["api", "-X", "PATCH", GH_REPO_ENDPOINT, "--input", "-"], { input: JSON.stringify(SECURITY_SETTINGS_PATCH) });
  return succeeded(patch)
    ? result("secret-scanning", label, "applied", "turned on")
    : result("secret-scanning", label, "left", `needs repo admin, and a public repo or GitHub Advanced Security: Settings, Code security (${failure(patch)})`);
};

const privateReports = ({ run }: SecurityContext): SecurityResult => {
  const label = "Private vulnerability reports";
  const read = run("gh", ["api", GH_PRIVATE_REPORTING_ENDPOINT]);
  if (succeeded(read) && nested(parseObject(read.stdout), "enabled") === true) return result("private-reports", label, "already", "on");
  const put = run("gh", ["api", "-X", "PUT", GH_PRIVATE_REPORTING_ENDPOINT]);
  return succeeded(put)
    ? result("private-reports", label, "applied", "turned on")
    : result("private-reports", label, "left", `needs repo admin: Settings, Code security, Private vulnerability reporting (${failure(put)})`);
};

const hasReviewer = (text: string): boolean => {
  const rules = nested(parseObject(text), "protection_rules");
  return Array.isArray(rules) && rules.some((rule) => nested(rule, "type") === "required_reviewers");
};

const repoRules = (context: SecurityContext): SecurityResult => {
  const label = "Repo rules and production approval";
  const outcome = context.applyRules(REPO_RULES_ARGS);
  const approval = context.run("gh", ["api", `${GH_ENVIRONMENT_ENDPOINT}/${GH_PRODUCTION_ENVIRONMENT}`]);
  if (outcome.code === 0 && succeeded(approval) && hasReviewer(approval.stdout))
    return result("repo-rules", label, "applied", "rulesets and the production approval match .github/repo-rules.json");
  const why = [...outcome.stderr, ...outcome.stdout].filter((line) => line.startsWith("error:")).join("; ");
  return result(
    "repo-rules",
    label,
    "left",
    `run bun run scripts/repo-rules.ts --apply as a repo admin (${why || "the production environment has no required reviewer"})`,
  );
};

export const authSecretLength = (context: AuthSecretFacts): SecurityResult => {
  const label = "Auth secret length";
  if (context.authSecretsSet.length > 0)
    return result("auth-secret-length", label, "applied", `checked at least 32 characters when set: ${context.authSecretsSet.join(", ")}`);
  if (context.authSecretsKept)
    return result(
      "auth-secret-length",
      label,
      "left",
      "a store never returns a secret, so an older one cannot be measured; --rotate-auth-secret writes a fresh 64-character one",
    );
  return result("auth-secret-length", label, "left", "no auth secret was set in this run");
};

export const runSecurityPass = (context: SecurityContext): ReadonlyArray<SecurityResult> => [
  repoRules(context),
  dependencyAlerts(context),
  secretScanning(context),
  privateReports(context),
];

export const renderSecurity = (results: ReadonlyArray<SecurityResult>): string[] => [
  ...results.map((entry) => `${entry.status.padEnd(7)}  ${entry.label}: ${entry.detail}`),
  ...(results.some((entry) => entry.status === "left") ? ["Left for you: the lines marked left above."] : []),
];
