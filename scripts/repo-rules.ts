/**
 * Repo rules as code: branch protection and the `production` environment, declared in
 * `.github/repo-rules.json` and checked or applied through the GitHub API.
 *
 *   bun run scripts/repo-rules.ts --check
 *   bun run scripts/repo-rules.ts --apply [--dry-run]
 *
 * --check reads only. It exits 1 on drift or error. When nothing is applied (no ruleset by that
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
import { readFileSync } from "node:fs";
import { Effect, Either, Schema } from "effect";
import { ghSpawn, type GhResult, type GhRunner } from "./lib/gh";

export type { GhResult };

export interface Deps {
  gh: GhRunner;
  /** Right is the file text, left is why it could not be read. Never throws. */
  readFile: (path: string) => Either.Either<string, string>;
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
  env: process.env,
};

const CONFIG_PATH = ".github/repo-rules.json";
const CI_PATH = ".github/workflows/ci.yml";
const APPLY_CMD = "bun run scripts/repo-rules.ts --apply";
const USAGE = "usage: bun run scripts/repo-rules.ts --check | --apply [--dry-run]";

// ---------------------------------------------------------------- schemas

const Params = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const Rule = Schema.Struct({ type: Schema.String, parameters: Schema.optional(Params) });

const DeclaredRuleset = Schema.Struct({
  name: Schema.String,
  target: Schema.String,
  enforcement: Schema.String,
  bypass_actors: Schema.Array(Schema.Unknown),
  conditions: Schema.Struct({
    ref_name: Schema.Struct({ include: Schema.Array(Schema.String), exclude: Schema.Array(Schema.String) }),
  }),
  rules: Schema.Array(Rule),
});
// Names go into URL paths, so keep out anything that could change the path or query.
const PathSafe = Schema.String.pipe(
  Schema.filter((s) => s.length > 0 && !/\.\.|[?#{\s]/.test(s), {
    message: () => "must not be empty or contain '..', '?', '#', '{' or whitespace",
  }),
);
const Reviewer = Schema.String.pipe(
  Schema.filter((s) => s === "@owner" || /^[A-Za-z0-9-]+$/.test(s) || (/^[A-Za-z0-9-]+\/[\w-][\w.-]*$/.test(s) && !s.includes("..")), {
    message: () => "a reviewer is @owner, a GitHub login, or org/team-slug",
  }),
);
const DeclaredEnv = Schema.Struct({
  name: PathSafe,
  reviewers: Schema.Array(Reviewer),
  prevent_self_review: Schema.Boolean,
  deployment_branches: Schema.Array(PathSafe),
});
const Config = Schema.Struct({ ruleset: DeclaredRuleset, environments: Schema.Array(DeclaredEnv) });
type Ruleset = typeof DeclaredRuleset.Type;
type DeclaredEnvironment = typeof DeclaredEnv.Type;

// GitHub adds fields we do not declare. These schemas name only the fields we compare.
const RepoInfo = Schema.Struct({
  default_branch: Schema.String,
  owner: Schema.Struct({ login: Schema.String, id: Schema.Number, type: Schema.String }),
  permissions: Schema.optional(Schema.Struct({ admin: Schema.optional(Schema.Boolean) })),
});
const RulesetList = Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String }));
const LiveRuleset = Schema.Struct({
  target: Schema.String,
  enforcement: Schema.String,
  bypass_actors: Schema.optional(Schema.Array(Schema.Unknown)),
  conditions: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        ref_name: Schema.optional(
          Schema.Struct({
            include: Schema.optional(Schema.Array(Schema.String)),
            exclude: Schema.optional(Schema.Array(Schema.String)),
          }),
        ),
      }),
    ),
  ),
  rules: Schema.Array(Rule),
});
const LiveEnv = Schema.Struct({
  protection_rules: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        prevent_self_review: Schema.optional(Schema.Boolean),
        reviewers: Schema.optional(
          Schema.Array(
            Schema.Struct({
              type: Schema.String,
              reviewer: Schema.Struct({
                id: Schema.Number,
                login: Schema.optional(Schema.String),
                slug: Schema.optional(Schema.String),
              }),
            }),
          ),
        ),
      }),
    ),
  ),
  deployment_branch_policy: Schema.optional(
    Schema.NullOr(Schema.Struct({ protected_branches: Schema.Boolean, custom_branch_policies: Schema.Boolean })),
  ),
});
const BranchPolicies = Schema.Struct({
  branch_policies: Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String })),
});
const IdOnly = Schema.Struct({ id: Schema.Number });
const Contexts = Schema.Array(Schema.Struct({ context: Schema.String }));
type LiveRulesetT = typeof LiveRuleset.Type;
type LiveEnvT = typeof LiveEnv.Type;
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

/** JSON with sorted keys, so two equal values compare equal whatever their key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
}
const show = (v: unknown) => (v === undefined ? "absent" : JSON.stringify(v));
const sorted = (xs: readonly string[]) => [...xs].sort();

function contextsOf(v: unknown): string[] {
  const d = Schema.decodeUnknownEither(Contexts)(v);
  return Either.isRight(d) ? sorted(d.right.map((c) => c.context)) : [];
}

// ---------------------------------------------------------------- static check

function jobNames(yml: string): string[] {
  const names: string[] = [];
  let inJobs = false;
  for (const line of yml.split("\n")) {
    if (/^jobs:\s*$/.test(line)) inJobs = true;
    else if (/^[^\s#]/.test(line)) inJobs = false;
    const m = inJobs ? /^ {4}name:\s*(.+?)\s*$/.exec(line) : null;
    if (m) names.push(m[1].replace(/^(["'])(.*)\1$/, "$2"));
  }
  return names;
}

/** Load the declared rules and prove every required check names a real CI job. */
function staticCheck(deps: Deps, out: Out): typeof Config.Type | null {
  const file = deps.readFile(CONFIG_PATH);
  if (Either.isLeft(file)) {
    out.line("error", `cannot read ${CONFIG_PATH}: ${file.left}`);
    return null;
  }
  const parsed = Schema.decodeUnknownEither(Schema.parseJson(Config))(file.right);
  if (Either.isLeft(parsed)) {
    out.line("error", `${CONFIG_PATH} is not valid: ${squash(parsed.left.message)}`);
    return null;
  }
  const config = parsed.right;
  const ci = deps.readFile(CI_PATH);
  if (Either.isLeft(ci)) {
    out.line("error", `cannot read ${CI_PATH}: ${ci.left}`);
    return null;
  }
  const jobs = jobNames(ci.right);
  const required = config.ruleset.rules.flatMap((r) =>
    r.type === "required_status_checks" ? contextsOf(r.parameters?.required_status_checks) : [],
  );
  const missing = required.filter((c) => !jobs.includes(c));
  for (const c of missing) out.line("error", `required check "${c}" is not a job name in ${CI_PATH}`);
  if (missing.length) return null;
  out.line("ok", `${CONFIG_PATH} is valid and every required check is a job name in ${CI_PATH}`);
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
interface Gathered {
  ruleset: { id: number; live: LiveRulesetT } | null;
  envs: LiveEnvironment[];
}

function gather(config: typeof Config.Type, repo: Repo, deps: Deps): Read<Gathered> {
  const base = `repos/${repo.nwo}`;
  const list = getJson(deps, RulesetList, `${base}/rulesets?per_page=100&includes_parents=false`);
  if (!list.ok) return list;
  const found = (list.value ?? []).find((r) => r.name === config.ruleset.name);
  let ruleset: Gathered["ruleset"] = null;
  if (found) {
    const full = getJson(deps, LiveRuleset, `${base}/rulesets/${found.id}`);
    if (!full.ok) return full;
    if (!full.value) return unreadable(`ruleset ${found.id} disappeared while reading`);
    ruleset = { id: found.id, live: full.value };
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
  return good({ ruleset, envs });
}

const envPath = (repo: Repo, name: string) => `repos/${repo.nwo}/environments/${encodeURIComponent(name)}`;

// ---------------------------------------------------------------- planning (pure)

interface Finding {
  /** missing is "not applied"; its text names the subject only. */
  level: "ok" | "notice" | "missing" | "drift";
  text: string;
  /** A missing environment counts as drift only for an admin: GitHub may hide it from anyone else. */
  adminOnly?: boolean;
}
interface Action {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}
interface Plan {
  findings: Finding[];
  actions: Action[];
  /** True when something of this part is live, even if it differs. */
  applied: boolean;
}

/** Collects one drift line per field that differs. */
function differ(prefix: string) {
  const lines: string[] = [];
  return {
    lines,
    cmp(field: string, declared: unknown, live: unknown) {
      if (stable(declared) !== stable(live)) lines.push(`${prefix} ${field}: declared ${show(declared)}, live ${show(live)}`);
    },
  };
}

function rulesetDiffs(decl: Ruleset, live: LiveRulesetT): string[] {
  const d = differ(`ruleset "${decl.name}"`);
  // GitHub leaves bypass_actors out for a caller without admin rights; the caller reports that.
  const actors = (xs: readonly unknown[]) => xs.map(stable).sort();
  if (live.bypass_actors !== undefined) d.cmp("bypass_actors", actors(decl.bypass_actors), actors(live.bypass_actors));
  d.cmp("target", decl.target, live.target);
  d.cmp("enforcement", decl.enforcement, live.enforcement);
  const ref = live.conditions?.ref_name;
  d.cmp("conditions.ref_name.include", sorted(decl.conditions.ref_name.include), sorted(ref?.include ?? []));
  d.cmp("conditions.ref_name.exclude", sorted(decl.conditions.ref_name.exclude), sorted(ref?.exclude ?? []));

  const liveByType = new Map(live.rules.map((r) => [r.type, r]));
  for (const r of decl.rules) {
    const l = liveByType.get(r.type);
    if (!l) {
      d.lines.push(`ruleset "${decl.name}" rules.${r.type}: declared present, live absent`);
      continue;
    }
    for (const [key, value] of Object.entries(r.parameters ?? {})) {
      const field = `rules.${r.type}.${key}`;
      const liveValue = l.parameters?.[key];
      if (r.type === "required_status_checks" && key === "required_status_checks")
        d.cmp(field, contextsOf(value), liveValue === undefined ? undefined : contextsOf(liveValue));
      else d.cmp(field, value, liveValue);
    }
  }
  const declaredTypes = new Set(decl.rules.map((r) => r.type));
  for (const t of liveByType.keys())
    if (!declaredTypes.has(t)) d.lines.push(`ruleset "${decl.name}" rules.${t}: declared absent, live present`);
  return d.lines;
}

function planRuleset(decl: Ruleset, live: Gathered["ruleset"], base: string): Plan {
  const name = decl.name;
  if (!live)
    return {
      findings: [{ level: "missing", text: `ruleset "${name}"` }],
      actions: [{ method: "POST", path: `${base}/rulesets`, body: decl }],
      applied: false,
    };
  const diffs = rulesetDiffs(decl, live.live);
  const findings: Finding[] = diffs.map((text) => ({ level: "drift", text }));
  if (live.live.bypass_actors === undefined)
    findings.push({ level: "notice", text: `ruleset "${name}" bypass list cannot be read without admin rights; not checked` });
  else if (!diffs.length) findings.push({ level: "ok", text: `ruleset "${name}" matches ${CONFIG_PATH}` });
  return {
    findings,
    actions: diffs.length ? [{ method: "PUT", path: `${base}/rulesets/${live.id}`, body: decl }] : [],
    applied: true,
  };
}

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
    planRuleset(config.ruleset, gathered.value.ruleset, base),
    ...gathered.value.envs.map((e) => planEnv(e, envPath(repo.value, e.decl.name))),
  ];

  if (!mode.apply) {
    // Nothing applied is a fresh fork: a notice. Any part applied makes every missing part drift,
    // so weakening one half after an apply fails the gate.
    const anyApplied = plans.some((p) => p.applied);
    for (const f of plans.flatMap((p) => p.findings)) {
      if (f.level !== "missing") out.line(f.level, f.text);
      else if (anyApplied && f.adminOnly && !repo.value.admin)
        out.line("notice", `${f.text} shows no protection to this token; only an admin can check it`);
      else if (anyApplied) out.line("drift", `${f.text} is not applied but other rules are; run: ${APPLY_CMD}`);
      else out.line("notice", `${f.text} is not applied; run: ${APPLY_CMD}`);
    }
    return finish(out);
  }

  const actions = plans.flatMap((p) => p.actions);
  if (!actions.length) out.line("ok", `nothing needs to change; the repo matches ${CONFIG_PATH}`);
  else execute(actions, mode.dryRun, deps, out);
  return finish(out);
}

if (import.meta.main) {
  const o = run(process.argv.slice(2));
  for (const l of o.stdout) console.log(l);
  for (const l of o.stderr) console.error(l);
  process.exit(o.code);
}
