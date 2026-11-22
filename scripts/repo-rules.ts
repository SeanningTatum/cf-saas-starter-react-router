/**
 * Repo rules as code: branch protection and the `production` environment, declared in
 * `.github/repo-rules.json` and checked or applied through the GitHub API.
 *
 *   bun run scripts/repo-rules.ts --check
 *   bun run scripts/repo-rules.ts --apply [--dry-run]
 *
 * The file declares two rulesets (`default-branch`, `production`), the `production` environment and
 * an optional `repository` section (the squash commit title).
 * A required check or the `repository` section may carry `"pending": "<reason>"`: declared, not
 * applied yet. --check turns a pending item the repo lacks into a notice; --apply writes it anyway.
 * --check reads only. It exits 1 on drift or error. When nothing is applied (no ruleset by either
 * name and every environment bare) that is a notice, so a fresh fork passes. Once any part is
 * applied, every missing part is drift. When GitHub cannot be read (no gh, not logged in, no
 * access) it prints a notice and exits 0, so a fork's CI never fails for lack of admin rights.
 * --apply makes the repo match the file. --dry-run reads only and prints the writes it would make.
 * Running --apply twice makes no write the second time.
 *
 * Every stdout line starts with one of: ok: notice: drift: would: did: error:
 * Exit codes: 0 fine, 1 drift or error, 2 bad usage.
 *
 * The `gh` process and the file reader are injected (`Deps`), so the tests run with no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { Effect, Either, Schema } from "effect";
import { ghSpawn, type GhResult, type GhRunner } from "./lib/gh";
import { PENDING_APPLIED_NOTICE, PENDING_DRY_RUN_NOTICE, CONFIG_PATH } from "./lib/repo-rules-constants";
import { differ, sorted, stable } from "./lib/repo-rules-diff";
import { planRepository, planRuleset, type Action, type Plan } from "./lib/repo-rules-plan";
import { jobNames, requiredContexts } from "./lib/repo-rules-workflow-checks";
import {
  BranchPolicies,
  checkProblems,
  Config,
  hasOldShape,
  IdOnly,
  LiveEnv,
  LiveRuleset,
  RepoInfo,
  RulesetList,
  type ConfigT,
  type DeclaredEnvironment,
  type LiveEnvT,
  type LiveRulesetT,
  type Ruleset,
} from "./lib/repo-rules-schemas";

export type { GhResult };

export interface Deps {
  gh: GhRunner;
  /** Right is the file text, left is why it could not be read. Never throws. */
  readFile: (path: string) => Either.Either<string, string>;
  /** Right is the file names in a folder, left is why it could not be read. Never throws. */
  listDir: (path: string) => Either.Either<string[], string>;
  env: Record<string, string | undefined>;
}

export interface Outcome {
  code: number;
  stdout: string[];
  stderr: string[];
}

export const defaultDeps: Deps = {
  gh: ghSpawn,
  readFile: (path) =>
    Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => readFileSync(path, "utf8"),
          catch: (e) => (e instanceof Error ? e.message : String(e)),
        }),
      ),
    ),
  listDir: (path) =>
    Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => readdirSync(path),
          catch: (e) => (e instanceof Error ? e.message : String(e)),
        }),
      ),
    ),
  env: process.env,
};

const WORKFLOWS_DIR = ".github/workflows";
const APPLY_CMD = "bun run scripts/repo-rules.ts --apply";
const USAGE = "usage: bun run scripts/repo-rules.ts --check | --apply [--dry-run]";

type Policy = { id: number; name: string };

// ---------------------------------------------------------------- output

type Kind = "ok" | "notice" | "drift" | "error" | "would" | "did";

function makeOut(env: Deps["env"]) {
  const annotate = env.GITHUB_ACTIONS === "true";
  const stdout: string[] = [];
  let failed = false;
  return {
    stdout,
    get failed() {
      return failed;
    },
    line(kind: Kind, text: string) {
      stdout.push(`${kind}: ${text}`);
      if (kind === "drift" || kind === "error") failed = true;
      if (annotate && kind === "notice") stdout.push(`::notice::${text}`);
      if (annotate && (kind === "drift" || kind === "error")) stdout.push(`::error::${text}`);
    },
  };
}
type Out = ReturnType<typeof makeOut>;

const finish = (out: Out): Outcome => ({ code: out.failed ? 1 : 0, stdout: out.stdout, stderr: [] });

// ---------------------------------------------------------------- small helpers

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim() ?? "";

// ---------------------------------------------------------------- static check

function workflowJobNames(deps: Deps, out: Out): string[] | null {
  const files = deps.listDir(WORKFLOWS_DIR);
  if (Either.isLeft(files)) {
    out.line("error", `cannot read ${WORKFLOWS_DIR}: ${files.left}`);
    return null;
  }
  const names: string[] = [];
  for (const file of files.right.filter((f) => /\.ya?ml$/.test(f))) {
    const text = deps.readFile(`${WORKFLOWS_DIR}/${file}`);
    if (Either.isLeft(text)) {
      out.line("error", `cannot read ${WORKFLOWS_DIR}/${file}: ${text.left}`);
      return null;
    }
    names.push(...jobNames(text.right));
  }
  return names;
}

/** Load the declared rules and prove every required check names a real workflow job. */
function staticCheck(deps: Deps, out: Out): ConfigT | null {
  const file = deps.readFile(CONFIG_PATH);
  if (Either.isLeft(file)) {
    out.line("error", `cannot read ${CONFIG_PATH}: ${file.left}`);
    return null;
  }
  if (hasOldShape(file.right)) {
    out.line("error", `${CONFIG_PATH} has the old "ruleset" key; rename it to "rulesets" and make it an array of rulesets`);
    return null;
  }
  const parsed = Schema.decodeUnknownEither(Schema.parseJson(Config))(file.right);
  if (Either.isLeft(parsed)) {
    out.line("error", `${CONFIG_PATH} is not valid: ${squash(parsed.left.message)}`);
    return null;
  }
  const config = parsed.right;
  const problems = checkProblems(config.rulesets);
  for (const m of problems) out.line("error", m);
  if (problems.length) return null;
  const jobs = workflowJobNames(deps, out);
  if (!jobs) return null;
  const missing = requiredContexts(config.rulesets).filter((c) => !jobs.includes(c));
  for (const c of missing) out.line("error", `required check "${c}" is not a job name in any workflow under ${WORKFLOWS_DIR}`);
  if (missing.length) return null;
  out.line("ok", `${CONFIG_PATH} is valid and every required check is a job name in a workflow under ${WORKFLOWS_DIR}`);
  return config;
}

// ---------------------------------------------------------------- reading GitHub

type Read<T> = { ok: true; value: T } | { ok: false; kind: "unreadable" | "config"; reason: string };
const good = <T>(value: T): Read<T> => ({ ok: true, value });
const unreadable = (reason: string): Read<never> => ({ ok: false, kind: "unreadable", reason });
const configError = (reason: string): Read<never> => ({ ok: false, kind: "config", reason });

function failureReason(r: GhResult): string {
  if (r.code === 127) return "the GitHub CLI (gh) is not installed or cannot run";
  return firstLine(r.stderr) || firstLine(r.stdout) || `gh exited ${r.code}`;
}

/** GET a path and decode it. With `allow404`, HTTP 404 reads as null. */
function getJson<A, I>(deps: Deps, schema: Schema.Schema<A, I>, path: string, allow404 = false): Read<A | null> {
  const r = deps.gh(["api", path]);
  if (r.code !== 0) {
    if (allow404 && /HTTP 404/.test(r.stderr)) return good(null);
    return unreadable(failureReason(r));
  }
  const d = Schema.decodeUnknownEither(Schema.parseJson(schema))(r.stdout);
  if (Either.isLeft(d)) return unreadable(`unexpected answer for ${path}: ${squash(d.left.message)}`);
  return good(d.right);
}

interface Repo {
  nwo: string;
  defaultBranch: string;
  owner: { login: string; id: number; type: string };
  /** Whether the caller has admin rights. Only an admin is sure to see the protection on an environment. */
  admin: boolean;
  /** GitHub shows this field only to tokens with enough rights. */
  squashTitle: string | undefined;
}

function readRepo(deps: Deps): Read<Repo> {
  let nwo = deps.env.GITHUB_REPOSITORY?.trim() ?? "";
  if (!nwo) {
    const r = deps.gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    if (r.code !== 0) return unreadable(failureReason(r));
    nwo = r.stdout.trim();
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(nwo) || nwo.split("/").some((seg) => /^\.+$/.test(seg))) return unreadable(`unexpected repository name "${nwo}"`);
  const info = getJson(deps, RepoInfo, `repos/${nwo}`);
  if (!info.ok) return info;
  if (!info.value) return unreadable(`no answer for repos/${nwo}`);
  return good({
    nwo,
    defaultBranch: info.value.default_branch,
    owner: info.value.owner,
    admin: info.value.permissions?.admin === true,
    squashTitle: info.value.squash_merge_commit_title,
  });
}

interface Reviewer {
  label: string;
  type: "User" | "Team";
  id: number;
}
interface ResolvedEnv {
  name: string;
  reviewers: Reviewer[];
  preventSelfReview: boolean;
  branches: string[];
}

function resolveReviewer(raw: string, repo: Repo, deps: Deps): Read<Reviewer> {
  if (raw === "@owner") {
    if (repo.owner.type !== "User")
      return configError(
        `"@owner" cannot be a reviewer because ${repo.owner.login} is an organisation; list a user or team in ${CONFIG_PATH}`,
      );
    return good({ label: raw, type: "User", id: repo.owner.id });
  }
  const isTeam = raw.includes("/");
  const path = isTeam ? `orgs/${raw.split("/")[0]}/teams/${raw.split("/")[1]}` : `users/${raw}`;
  const r = getJson(deps, IdOnly, path, true);
  if (!r.ok) return r;
  if (!r.value) return configError(`reviewer "${raw}" was not found on GitHub; fix ${CONFIG_PATH}`);
  return good({ label: raw, type: isTeam ? "Team" : "User", id: r.value.id });
}

function resolveEnv(decl: DeclaredEnvironment, repo: Repo, deps: Deps): Read<ResolvedEnv> {
  const reviewers: Reviewer[] = [];
  for (const raw of decl.reviewers) {
    const r = resolveReviewer(raw, repo, deps);
    if (!r.ok) return r;
    reviewers.push(r.value);
  }
  return good({
    name: decl.name,
    reviewers,
    preventSelfReview: decl.prevent_self_review,
    branches: decl.deployment_branches.map((b) => (b === "~DEFAULT_BRANCH" ? repo.defaultBranch : b)),
  });
}

interface LiveEnvironment {
  decl: ResolvedEnv;
  live: LiveEnvT | null;
  policies: Policy[];
}
interface LiveRulesetFound {
  decl: Ruleset;
  found: { id: number; live: LiveRulesetT } | null;
}
interface Gathered {
  rulesets: LiveRulesetFound[];
  envs: LiveEnvironment[];
}

function gather(config: ConfigT, repo: Repo, deps: Deps): Read<Gathered> {
  const base = `repos/${repo.nwo}`;
  const list = getJson(deps, RulesetList, `${base}/rulesets?per_page=100&includes_parents=false`);
  if (!list.ok) return list;
  const rulesets: LiveRulesetFound[] = [];
  for (const decl of config.rulesets) {
    const entry = (list.value ?? []).find((r) => r.name === decl.name);
    if (!entry) {
      rulesets.push({ decl, found: null });
      continue;
    }
    const full = getJson(deps, LiveRuleset, `${base}/rulesets/${entry.id}`);
    if (!full.ok) return full;
    if (!full.value) return unreadable(`ruleset ${entry.id} disappeared while reading`);
    rulesets.push({ decl, found: { id: entry.id, live: full.value } });
  }
  const envs: LiveEnvironment[] = [];
  for (const d of config.environments) {
    const decl = resolveEnv(d, repo, deps);
    if (!decl.ok) return decl;
    const path = envPath(repo, d.name);
    const live = getJson(deps, LiveEnv, path, true);
    if (!live.ok) return live;
    let policies: Policy[] = [];
    if (live.value) {
      const p = getJson(deps, BranchPolicies, `${path}/deployment-branch-policies`, true);
      if (!p.ok) return p;
      policies = [...(p.value?.branch_policies ?? [])];
    }
    envs.push({ decl: decl.value, live: live.value, policies });
  }
  return good({ rulesets, envs });
}

const envPath = (repo: Repo, name: string) => `repos/${repo.nwo}/environments/${encodeURIComponent(name)}`;

// ---------------------------------------------------------------- planning (pure)

function branchPolicyActions(decl: ResolvedEnv, policies: Policy[], path: string): Action[] {
  const liveNames = policies.map((p) => p.name);
  return [
    ...decl.branches
      .filter((b) => !liveNames.includes(b))
      .map((b): Action => ({ method: "POST", path: `${path}/deployment-branch-policies`, body: { name: b, type: "branch" } })),
    ...policies
      .filter((p) => !decl.branches.includes(p.name))
      .map((p): Action => ({ method: "DELETE", path: `${path}/deployment-branch-policies/${p.id}` })),
  ];
}

const PROTECTION = { protected_branches: false, custom_branch_policies: true };
const reviewerKey = (type: string, id: number) => `${type}:${id}`;

function planEnv(e: LiveEnvironment, path: string): Plan {
  const { decl, live, policies } = e;
  const name = decl.name;
  const put: Action = {
    method: "PUT",
    path,
    body: {
      prevent_self_review: decl.preventSelfReview,
      reviewers: decl.reviewers.map((r) => ({ type: r.type, id: r.id })),
      deployment_branch_policy: PROTECTION,
    },
  };

  const reviewRule = live?.protection_rules?.find((r) => r.type === "required_reviewers");
  const bare = !live || (!reviewRule && !live.deployment_branch_policy);

  const d = differ(`environment "${name}"`);
  const liveReviewers = reviewRule?.reviewers ?? [];
  const liveKeys = liveReviewers.map((r) => reviewerKey(r.type, r.reviewer.id)).sort();
  const declKeys = decl.reviewers.map((r) => reviewerKey(r.type, r.id)).sort();
  if (stable(liveKeys) !== stable(declKeys))
    d.cmp(
      "reviewers",
      decl.reviewers.map((r) => r.label).sort(),
      liveReviewers.map((r) => r.reviewer.login ?? r.reviewer.slug ?? String(r.reviewer.id)).sort(),
    );
  d.cmp("prevent_self_review", decl.preventSelfReview, reviewRule?.prevent_self_review ?? false);
  d.cmp("deployment_branch_policy", PROTECTION, live?.deployment_branch_policy ?? null);
  const protectionDrift = d.lines.length > 0;

  d.cmp("deployment_branches", sorted(decl.branches), sorted(policies.map((p) => p.name)));
  const branchActions = branchPolicyActions(decl, policies, path);

  if (bare)
    return { findings: [{ level: "missing", text: `environment "${name}"`, adminOnly: true }], actions: [put, ...branchActions], applied: false };
  if (!d.lines.length)
    return { findings: [{ level: "ok", text: `environment "${name}" matches ${CONFIG_PATH}` }], actions: [], applied: true };
  return {
    findings: d.lines.map((text) => ({ level: "drift" as const, text })),
    actions: [...(protectionDrift ? [put] : []), ...branchActions],
    applied: true,
  };
}

// ---------------------------------------------------------------- running writes

function adminHint(method: string, path: string, stderr: string): string {
  const status = /HTTP (\d{3})/.exec(stderr)?.[1];
  if (status === "403" || status === "404") return "; the token needs admin rights on the repo";
  if (status === "422" && method === "PUT" && path.includes("/environments/"))
    return "; required reviewers on a private repo need a paid GitHub plan";
  return "";
}

/** Runs each action in order. Stops at the first failure. Returns false when one failed. */
function execute(actions: Action[], dryRun: boolean, deps: Deps, out: Out): boolean {
  for (const a of actions) {
    const body = a.body === undefined ? undefined : JSON.stringify(a.body);
    if (dryRun) {
      out.line("would", `${a.method} ${a.path}${body ? ` ${body}` : ""}`);
      continue;
    }
    const args = ["api", "-X", a.method, a.path, ...(body ? ["--input", "-"] : [])];
    const r = deps.gh(args, body);
    if (r.code !== 0) {
      out.line("error", `${a.method} ${a.path} failed: ${failureReason(r)}${adminHint(a.method, a.path, r.stderr)}`);
      return false;
    }
    out.line("did", `${a.method} ${a.path}`);
  }
  return true;
}

// ---------------------------------------------------------------- entry

type Mode = { apply: boolean; dryRun: boolean };

function parseMode(argv: string[]): Mode | string {
  const known = ["--check", "--apply", "--dry-run"];
  const bad = argv.find((a) => !known.includes(a));
  if (bad) return `unknown argument ${bad}`;
  const has = (f: string) => argv.includes(f);
  if (has("--check") === has("--apply")) return "give exactly one of --check or --apply";
  if (has("--dry-run") && has("--check")) return "--dry-run goes with --apply";
  return { apply: has("--apply"), dryRun: has("--dry-run") };
}

function unread(r: { kind: "unreadable" | "config"; reason: string }, mode: Mode, out: Out): Outcome {
  if (r.kind === "config") out.line("error", r.reason);
  else if (mode.apply) out.line("error", `cannot apply repo rules: ${r.reason}`);
  else out.line("notice", `repo rules not checked: ${r.reason}`);
  return finish(out);
}

/** Run one CLI invocation. Pure of process state: returns the exit code and what to print. */
export function run(argv: string[], deps: Deps = defaultDeps): Outcome {
  const mode = parseMode(argv);
  if (typeof mode === "string") return { code: 2, stdout: [], stderr: [mode, USAGE] };

  const out = makeOut(deps.env);
  const config = staticCheck(deps, out);
  if (!config) return finish(out);

  const repo = readRepo(deps);
  if (!repo.ok) return unread(repo, mode, out);
  const gathered = gather(config, repo.value, deps);
  if (!gathered.ok) return unread(gathered, mode, out);

  const base = `repos/${repo.value.nwo}`;
  const plans = [
    ...gathered.value.rulesets.map((r) => planRuleset(r.decl, r.found, base)),
    ...gathered.value.envs.map((e) => planEnv(e, envPath(repo.value, e.decl.name))),
    ...(config.repository ? [planRepository(config.repository, repo.value.squashTitle, repo.value.nwo)] : []),
  ];

  if (!mode.apply) {
    // Nothing applied is a fresh fork: a notice. Any part applied makes every missing part drift,
    // so weakening one half after an apply fails the gate.
    const anyApplied = plans.some((p) => p.applied);
    for (const f of plans.flatMap((p) => p.findings)) {
      if (f.level === "drift" && f.softWhenFresh && !anyApplied) out.line("notice", `${f.text}; run: ${APPLY_CMD}`);
      else if (f.level !== "missing") out.line(f.level, f.text);
      else if (anyApplied && f.adminOnly && !repo.value.admin)
        out.line("notice", `${f.text} shows no protection to this token; only an admin can check it`);
      else if (anyApplied) out.line("drift", `${f.text} is not applied but other rules are; run: ${APPLY_CMD}`);
      else out.line("notice", `${f.text} is not applied; run: ${APPLY_CMD}`);
    }
    return finish(out);
  }

  const actions = plans.flatMap((p) => p.actions);
  if (!actions.length) out.line("ok", `nothing needs to change; the repo matches ${CONFIG_PATH}`);
  else if (execute(actions, mode.dryRun, deps, out) && actions.some((a) => a.pending))
    out.line("notice", mode.dryRun ? PENDING_DRY_RUN_NOTICE : PENDING_APPLIED_NOTICE);
  return finish(out);
}

if (import.meta.main) {
  const o = run(process.argv.slice(2));
  for (const l of o.stdout) console.log(l);
  for (const l of o.stderr) console.error(l);
  process.exit(o.code);
}
