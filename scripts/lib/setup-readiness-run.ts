import type { Outcome } from "../repo-rules";
import { applyPlan, describeApplied, type Applied } from "./setup-apply";
import type { SetupRequest } from "./setup-args";
import { SECURITY_HINT, SECURITY_QUESTION, UNPROTECTED_NOTE } from "./setup-constants";
import { buildPlan, type Ask } from "./setup-plan";
import { evaluate, exitCodeOf, readSnapshot, renderTable } from "./setup-readiness";
import type { Runner } from "./setup-run";
import { authSecretLength, renderSecurity, runSecurityPass } from "./setup-security";
import type { StoreContext } from "./setup-stores";
import type { WranglerConfig } from "./setup-wrangler-vars";

export interface ReadinessDeps {
  readonly run: Runner;
  readonly ask: Ask | undefined;
  readonly readConfig: () => WranglerConfig | null;
  readonly writeConfig: (config: WranglerConfig) => void;
  readonly applyRules: (argv: string[]) => Outcome;
  readonly generateSecret: () => string;
  readonly saveLocalEnv: (key: string, value: string) => void;
  readonly accountId: string | undefined;
}

export interface ReadinessOutcome {
  readonly code: number;
  readonly lines: ReadonlyArray<string>;
  readonly varsChanged: boolean;
}

export const runCheck = (deps: Pick<ReadinessDeps, "run" | "readConfig">): ReadinessOutcome => {
  const rows = evaluate(readSnapshot(deps.run, deps.readConfig()));
  return { code: exitCodeOf(rows), lines: renderTable(rows), varsChanged: false };
};

const wantsSecurity = async (request: SetupRequest, deps: ReadinessDeps): Promise<boolean> => {
  if (request.security !== undefined) return request.security;
  if (deps.ask === undefined || request.yes) return false;
  return deps.ask.confirm(SECURITY_QUESTION, false);
};

const authLines = (applied: ReadonlyArray<Applied>): { set: string[]; failed: boolean } => ({
  set: applied.filter((entry) => entry.item.generated === true && entry.error === undefined).map((entry) => entry.item.id),
  failed: applied.some((entry) => entry.error !== undefined),
});

const TOKEN_IDS: ReadonlyArray<string> = ["production-token", "staging-token"];

export const runPass = async (request: SetupRequest, deps: ReadinessDeps): Promise<ReadinessOutcome> => {
  const before = readSnapshot(deps.run, deps.readConfig());
  const lines: string[] = [];
  const secured = await wantsSecurity(request, deps);
  const securityResults = secured ? runSecurityPass({ run: deps.run, applyRules: deps.applyRules }) : [];
  const plan = await buildPlan({ request, snapshot: before, ask: deps.ask, generateSecret: deps.generateSecret, detectedAccountId: deps.accountId });
  const context: StoreContext = { run: deps.run, ...(deps.accountId ? { accountId: deps.accountId } : {}) };
  const outcome = applyPlan(plan, {
    context,
    config: deps.readConfig(),
    writeConfig: deps.writeConfig,
    generateSecret: deps.generateSecret,
    saveLocalEnv: deps.saveLocalEnv,
    snapshot: before,
  });
  lines.push(...plan.problems.map((problem) => `refused: ${problem}`), ...outcome.applied.map(describeApplied), ...outcome.notes);
  const { set, failed } = authLines(outcome.applied);
  if (secured) {
    const auth = authSecretLength({ authSecretsSet: set, authSecretsKept: plan.kept.some((item) => item.generated === true) });
    lines.push("", ...renderSecurity([...securityResults, auth]));
  } else {
    const tokenSet = outcome.applied.some((entry) => TOKEN_IDS.includes(entry.item.id) && entry.error === undefined);
    lines.push("", tokenSet ? UNPROTECTED_NOTE : `Security settings were not touched. Apply them with: ${SECURITY_HINT}`);
  }
  const rows = evaluate(readSnapshot(deps.run, deps.readConfig()));
  lines.push("", ...renderTable(rows));
  return { code: failed || plan.problems.length > 0 ? 1 : 0, lines, varsChanged: outcome.varsChanged };
};
