import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, it, expect } from "vitest";
import { run, type Deps, type GhResult } from "../repo-rules";

// ---------------------------------------------------------------- fixtures

const REPO = "acme/saas";
const BASE = `repos/${REPO}`;
const CHECKS = ["Baseline (typecheck + test + harness-check)", "Build (Cloudflare Workers)", "E2E smoke (Playwright)"];
const GUARD = "Source branch is staging";
const ACTIONS_APP_ID = 15368;
const REVIEW_PARAMS = {
  required_approving_review_count: 0,
  require_code_owner_review: false,
  dismiss_stale_reviews_on_push: false,
  require_last_push_approval: false,
  required_review_thread_resolution: false,
};

const DEFAULT_BRANCH_DECLARED = {
    name: "default-branch",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "required_linear_history" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          require_code_owner_review: false,
          dismiss_stale_reviews_on_push: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: CHECKS.map((context) => ({ context })),
        },
      },
    ],
};

const PRODUCTION_DECLARED = {
  name: "production",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["refs/heads/production"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: { ...REVIEW_PARAMS, allowed_merge_methods: ["merge"] } },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: true,
        required_status_checks: [GUARD, ...CHECKS].map((context) => ({ context, integration_id: ACTIONS_APP_ID })),
      },
    },
  ],
};

const DECLARED = {
  rulesets: [DEFAULT_BRANCH_DECLARED, PRODUCTION_DECLARED],
  environments: [
    { name: "production", reviewers: ["@owner"], prevent_self_review: false, deployment_branches: ["~DEFAULT_BRANCH"] },
  ],
};

const workflowYml = (names: string[]) =>
  [
    "name: CI",
    "jobs:",
    ...names.flatMap((n, i) => [`  job${i}:`, `    name: ${n}`, "    steps:", "      - name: Not a job name"]),
  ].join("\n");

const ciYml = workflowYml;
const guardYml = workflowYml([GUARD]);

const files = (overrides: Record<string, string> = {}) => ({
  ".github/repo-rules.json": JSON.stringify(DECLARED),
  ".github/workflows/ci.yml": ciYml(CHECKS),
  ".github/workflows/production-guard.yml": guardYml,
  ...overrides,
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** What GitHub returns for the declared ruleset: the same rules plus fields we never declare. */
const LIVE_RULESET = {
  id: 7,
  name: "default-branch",
  node_id: "RRS_abc",
  target: "branch",
  source_type: "Repository",
  source: REPO,
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  _links: { self: { href: "x" } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_linear_history" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        require_code_owner_review: false,
        dismiss_stale_reviews_on_push: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ["merge", "squash", "rebase"],
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: CHECKS.map((context) => ({ context, integration_id: 15368 })),
      },
    },
  ],
};

const LIVE_PRODUCTION = {
  id: 9,
  name: "production",
  node_id: "RRS_prod",
  target: "branch",
  source_type: "Repository",
  source: REPO,
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { exclude: [], include: ["refs/heads/production"] } },
  created_at: "2026-01-03T00:00:00Z",
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: { ...REVIEW_PARAMS, required_reviewers: [], allowed_merge_methods: ["merge"] },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: true,
        required_status_checks: [GUARD, ...CHECKS].map((context) => ({ context, integration_id: ACTIONS_APP_ID })),
      },
    },
  ],
};

const OWNER = { login: "acme-owner", id: 42, type: "User" };

const LIVE_ENV = {
  id: 1,
  node_id: "EN_abc",
  name: "production",
  protection_rules: [
    {
      id: 2,
      node_id: "PR_1",
      type: "required_reviewers",
      prevent_self_review: false,
      reviewers: [{ type: "User", reviewer: { id: 42, login: "acme-owner", type: "User" } }],
    },
    { id: 3, node_id: "PR_2", type: "branch_policy" },
  ],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  _links: {},
};
const LIVE_POLICIES = { total_count: 1, branch_policies: [{ id: 11, node_id: "BP_1", name: "main", type: "branch" }] };

interface World {
  owner?: { login: string; id: number; type: string };
  /** Whether the caller is a repo admin. Default true. */
  admin?: boolean;
  /** Live default-branch ruleset object, or null for none. */
  ruleset?: unknown;
  /** Live production ruleset object, or null or undefined for none. */
  production?: unknown;
  /** Live environment object, or null for a 404. */
  env?: unknown;
  /** Branch policies, or null for a 404. */
  policies?: unknown;
  /** Reply for a call, checked first. Return undefined to fall through. */
  override?: (method: string, path: string) => Partial<GhResult> | undefined;
}

interface LiveRuleset { enforcement: string; bypass_actors?: unknown[]; rules: { type: string; parameters?: { required_status_checks: { context: string; integration_id?: number }[]; required_approving_review_count: number; allowed_merge_methods: string[] } }[]; conditions: { ref_name: { include: string[]; exclude: string[] } } }
type W = World & { ruleset: LiveRuleset; production: LiveRuleset; env: { protection_rules: [{ reviewers: unknown[]; prevent_self_review: boolean }, ...unknown[]]; deployment_branch_policy: unknown }; policies: { branch_policies: unknown[] } | null };

const notFound: Partial<GhResult> = { code: 1, stderr: "gh: Not Found (HTTP 404)" };
const json = (v: unknown): Partial<GhResult> => ({ stdout: JSON.stringify(v) });

function sync(): World {
  return { ruleset: clone(LIVE_RULESET), production: clone(LIVE_PRODUCTION), env: clone(LIVE_ENV), policies: clone(LIVE_POLICIES) };
}

interface Call {
  args: string[];
  input?: string;
}

function harness(world: World, opts: { files?: Record<string, string>; env?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const files = opts.files ?? {
    ".github/repo-rules.json": JSON.stringify(DECLARED),
    ".github/workflows/ci.yml": ciYml(CHECKS),
    ".github/workflows/production-guard.yml": guardYml,
  };
  const deps: Deps = {
    gh: (args, input) => {
      calls.push({ args, input });
      const write = args[1] === "-X";
      const method = (write ? args[2] : "GET") ?? "";
      const path = (write ? args[3] : args[1]) ?? "";
      const over = world.override?.(method, path);
      if (over) return { code: 0, stdout: "", stderr: "", ...over };
      const reply = (r: Partial<GhResult>): GhResult => ({ code: 0, stdout: "", stderr: "", ...r });
      if (write) return reply(json({}));
      if (path === BASE) return reply(json({ default_branch: "main", owner: world.owner ?? OWNER, permissions: { admin: world.admin ?? true } }));
      if (path === `${BASE}/rulesets?per_page=100&includes_parents=false`)
        return reply(
          json([
            ...(world.ruleset ? [{ id: 7, name: "default-branch" }] : []),
            ...(world.production ? [{ id: 9, name: "production" }] : []),
            { id: 8, name: "other" },
          ]),
        );
      if (path === `${BASE}/rulesets/7`) return reply(json(world.ruleset));
      if (path === `${BASE}/rulesets/9`) return reply(json(world.production));
      if (path === `${BASE}/environments/production`) return reply(world.env ? json(world.env) : notFound);
      if (path === `${BASE}/environments/production/deployment-branch-policies`)
        return reply(world.policies ? json(world.policies) : notFound);
      return reply({ code: 1, stderr: `unexpected gh call: ${args.join(" ")}` });
    },
    readFile: (p) => (p in files ? Either.right(files[p] ?? "") : Either.left("ENOENT")),
    listDir: (dir) => {
      const names = Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1));
      return names.length ? Either.right(names) : Either.left("ENOENT");
    },
    env: { GITHUB_REPOSITORY: REPO, ...opts.env },
  };
  return { deps, calls };
}

const writes = (calls: Call[]) => calls.filter((c) => c.args.includes("-X"));
const lines = (stdout: string[], kind: string) => stdout.filter((l) => l.startsWith(`${kind}: `));
const check = (world: World, argv = ["--check"], opts = {}) => {
  const h = harness(world, opts);
  return { ...h, o: run(argv, h.deps) };
};

// ---------------------------------------------------------------- static

describe("static check", () => {
  it("a required check that is no CI job name fails with exit 1 even with no gh: a job rename would otherwise block every merge", () => {
    const { o, calls } = check({}, ["--check"], {
      files: files({
        ".github/workflows/ci.yml": ciYml(["Baseline (typecheck + test + harness-check)", "Build (Cloudflare Workers)", "Renamed e2e"]),
      }),
    });
    expect(o.code).toBe(1);
    const missing = 'error: required check "E2E smoke (Playwright)" is not a job name in any workflow under .github/workflows';
    expect(lines(o.stdout, "error")).toEqual([missing]);
    expect(calls).toEqual([]);
  });

  it("a required check that is a job in production-guard.yml passes the offline check: the guard lives outside ci.yml", () => {
    const { o } = check({}, ["--check"], { files: files() });
    expect(lines(o.stdout, "error")).toEqual([]);
    expect(o.stdout[0]).toMatch(/^ok: .*every required check is a job name in a workflow/);
  });

  it("a required check that is a job in no workflow fails the offline check: a deleted guard file would hang every release pull request", () => {
    const withoutGuard = files();
    delete (withoutGuard as Record<string, string>)[".github/workflows/production-guard.yml"];
    const { o, calls } = check({}, ["--check"], { files: withoutGuard });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")).toEqual([
      `error: required check "${GUARD}" is not a job name in any workflow under .github/workflows`,
    ]);
    expect(calls).toEqual([]);
  });

  it("a workflow file that cannot be read is an error, not a pass", () => {
    const h = harness({}, { files: files() });
    const readFile: Deps["readFile"] = (p) => (p.endsWith("ci.yml") ? Either.left("EACCES") : h.deps.readFile(p));
    const o = run(["--check"], { ...h.deps, readFile });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("cannot read .github/workflows/ci.yml: EACCES");
  });

  it("an unreadable workflows folder is an error, not a pass", () => {
    const h = harness({}, { files: files() });
    const o = run(["--check"], { ...h.deps, listDir: () => Either.left("ENOENT") });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("cannot read .github/workflows: ENOENT");
  });

  it("with gh missing the same bad name still exits 1: the static check needs no network", () => {
    const h = harness({ override: () => ({ code: 127, stderr: "cannot run gh" }) }, {
      files: files({ ".github/workflows/ci.yml": ciYml(["Only one job"]) }),
    });
    const o = run(["--check"], h.deps);
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")).toHaveLength(3);
  });

  it("step names are not job names: a check named after a step must fail", () => {
    const { o } = check({}, ["--check"], {
      files: files({
        ".github/workflows/ci.yml": ciYml(CHECKS.slice(0, 2)).replace("name: Not a job name", "name: E2E smoke (Playwright)"),
      }),
    });
    expect(o.code).toBe(1);
  });

  it("the real repo-rules.json and workflows pass: renaming a CI job breaks this test, not the merge button", () => {
    const real = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
    const workflows = ["ci.yml", "production-guard.yml", "pr-title.yml"].map((f) => `.github/workflows/${f}`);
    const h = harness({ override: () => ({ code: 127, stderr: "cannot run gh" }) }, {
      files: Object.fromEntries([".github/repo-rules.json", ...workflows].map((p) => [p, real(p)])),
    });
    const o = run(["--check"], h.deps);
    expect(lines(o.stdout, "error")).toEqual([]);
    expect(o.stdout[0]).toMatch(/^ok: .*every required check is a job name/);
    expect(o.code).toBe(0);
  });
});

describe("config file", () => {
  const bad = (text: string) =>
    check({}, ["--check"], { files: files({ ".github/repo-rules.json": text }) });

  it("malformed JSON gives error and exit 1 without throwing: a typo must not read as 'no rules'", () => {
    const { o, calls } = bad("{ not json");
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain(".github/repo-rules.json is not valid");
    expect(calls).toEqual([]);
  });

  it("a schema-invalid file gives error and exit 1: enforcement as a number must not reach GitHub", () => {
    const { o } = bad(JSON.stringify({ ...DECLARED, rulesets: [{ ...DECLARED.rulesets[0], enforcement: 1 }, ...DECLARED.rulesets.slice(1)] }));
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("is not valid");
  });

  it("the old single ruleset key is an error that says to rename it: it must not pass as no rules", () => {
    const old = { ruleset: DEFAULT_BRANCH_DECLARED, environments: DECLARED.environments };
    const { o, calls } = bad(JSON.stringify(old));
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")).toEqual([
      'error: .github/repo-rules.json has the old "ruleset" key; rename it to "rulesets" and make it an array of rulesets',
    ]);
    expect(calls).toEqual([]);
  });

  it("an empty rulesets list is an error: a file that declares no rule must not read as a pass", () => {
    const { o } = bad(JSON.stringify({ ...DECLARED, rulesets: [] }));
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("is not valid");
  });

  it("a missing file gives error and exit 1", () => {
    const { o } = check({}, ["--check"], { files: {} });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("cannot read .github/repo-rules.json");
  });

  it.each<[string, (c: { environments: [Record<string, unknown>] }) => unknown]>([
    ["a reviewer with a slash path", (c) => (c.environments[0].reviewers = ["a/b/c"])],
    ["a reviewer with a query", (c) => (c.environments[0].reviewers = ["octocat?x=1"])],
    ["an environment name with '..'", (c) => (c.environments[0].name = "../rulesets")],
    ["an environment name with '?'", (c) => (c.environments[0].name = "production?x")],
    ["an environment name with whitespace", (c) => (c.environments[0].name = "pro duction")],
    ["a deployment branch with '#'", (c) => (c.environments[0].deployment_branches = ["main#x"])],
    ["a deployment branch with '{'", (c) => (c.environments[0].deployment_branches = ["{main}"])],
  ])("%s is an error before any gh call: the value goes into a URL path", (_name, mutate) => {
    const c = JSON.parse(JSON.stringify(DECLARED));
    mutate(c);
    const { o, calls } = bad(JSON.stringify(c));
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("is not valid");
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------- cannot read

describe("cannot read GitHub", () => {
  const cases: [string, Partial<GhResult>][] = [
    ["gh missing (127)", { code: 127, stderr: "cannot run gh: ENOENT" }],
    ["HTTP 401", { code: 1, stderr: "gh: Bad credentials (HTTP 401)" }],
    ["HTTP 403", { code: 1, stderr: "gh: Resource not accessible by integration (HTTP 403)" }],
  ];
  for (const [name, fail] of cases) {
    it(`${name}: --check prints a notice and exits 0, so a fork's CI never fails for lack of rights`, () => {
      const { o, calls } = check({ override: () => fail });
      expect(o.code).toBe(0);
      expect(lines(o.stdout, "notice")).toHaveLength(1);
      expect(lines(o.stdout, "notice")[0]).toContain("repo rules not checked:");
      expect(writes(calls)).toEqual([]);
    });
    it(`${name}: --apply prints an error and exits 1, so apply never claims success`, () => {
      const { o, calls } = check({ override: () => fail }, ["--apply"]);
      expect(o.code).toBe(1);
      expect(lines(o.stdout, "error")[0]).toContain("cannot apply repo rules:");
      expect(writes(calls)).toEqual([]);
    });
  }

  it.each(["../x", "x/..", "./."])("a repository name %s is refused before any API call: dots would climb the API path", (nwo) => {
    const h = harness({}, { env: { GITHUB_REPOSITORY: nwo } });
    const o = run(["--check"], h.deps);
    expect(h.calls).toEqual([]);
    expect(lines(o.stdout, "notice")[0]).toContain("unexpected repository name");
  });

  it("without GITHUB_REPOSITORY the repo comes from gh repo view; a failure there is a notice", () => {
    const h = harness({ override: () => ({ code: 1, stderr: "not a git repository" }) }, { env: { GITHUB_REPOSITORY: "" } });
    const o = run(["--check"], h.deps);
    expect(o.code).toBe(0);
    expect(h.calls[0]?.args.slice(0, 2)).toEqual(["repo", "view"]);
    expect(lines(o.stdout, "notice")[0]).toContain("not a git repository");
  });
});

// ---------------------------------------------------------------- check

describe("--check: not applied", () => {
  it("neither ruleset exists and the environment is bare: three notices with exit 0, so a fresh fork is not broken", () => {
    const { o } = check({ ruleset: null, production: null, env: LIVE_ENV_BARE() });
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "notice")).toHaveLength(3);
    expect(lines(o.stdout, "drift")).toEqual([]);
  });

  it("an environment that returns 404 also counts as not applied", () => {
    const { o } = check({ ruleset: null, env: null });
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "notice")).toHaveLength(3);
  });

  it("rulesets applied but environment bare is drift with exit 1: weakening one half after an apply must fail the gate", () => {
    const { o } = check({ ruleset: clone(LIVE_RULESET), production: clone(LIVE_PRODUCTION), env: LIVE_ENV_BARE() });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "drift")).toEqual([
      'drift: environment "production" is not applied but other rules are; run: bun run scripts/repo-rules.ts --apply',
    ]);
    expect(lines(o.stdout, "notice")).toEqual([]);
  });

  it("the same bare environment seen without admin rights is a notice with exit 0: GitHub may hide protection from a CI token, and that must not turn every pull request red", () => {
    const { o } = check({ ruleset: clone(LIVE_RULESET), production: clone(LIVE_PRODUCTION), env: LIVE_ENV_BARE(), admin: false });
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "drift")).toEqual([]);
    expect(lines(o.stdout, "notice")).toEqual([
      'notice: environment "production" shows no protection to this token; only an admin can check it',
    ]);
  });

  it("environment applied but no ruleset is drift with exit 1: deleting both rulesets must fail the gate", () => {
    const { o } = check({ ruleset: null, env: clone(LIVE_ENV), policies: clone(LIVE_POLICIES) });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "drift")).toEqual([
      'drift: ruleset "default-branch" is not applied but other rules are; run: bun run scripts/repo-rules.ts --apply',
      'drift: ruleset "production" is not applied but other rules are; run: bun run scripts/repo-rules.ts --apply',
    ]);
  });

  it("default-branch exists but production does not: drift naming production and the fix, not a notice, so a fork that applied before the second ruleset sees it once", () => {
    const { o } = check({ ...sync(), production: null });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "drift")).toEqual([
      'drift: ruleset "production" is not applied but other rules are; run: bun run scripts/repo-rules.ts --apply',
    ]);
    expect(lines(o.stdout, "notice")).toEqual([]);
  });

  it("production exists but default-branch does not: drift naming default-branch", () => {
    const { o } = check({ ...sync(), ruleset: null });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "drift")).toEqual([
      'drift: ruleset "default-branch" is not applied but other rules are; run: bun run scripts/repo-rules.ts --apply',
    ]);
  });
});

function LIVE_ENV_BARE() {
  return { id: 1, name: "production", protection_rules: [], deployment_branch_policy: null };
}

describe("--check: in sync", () => {
  it("GitHub's extra fields (ids, integration_id, allowed_merge_methods, node_id, _links, created_at) do not count as drift", () => {
    const { o, calls } = check(sync());
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "ok")).toEqual([
      expect.stringContaining("every required check is a job name"),
      'ok: ruleset "default-branch" matches .github/repo-rules.json',
      'ok: ruleset "production" matches .github/repo-rules.json',
      'ok: environment "production" matches .github/repo-rules.json',
    ]);
    expect(lines(o.stdout, "drift")).toEqual([]);
    expect(lines(o.stdout, "error")).toEqual([]);
    expect(writes(calls)).toEqual([]);
  });

  it("key order and rule order in the live object do not matter", () => {
    const w = sync() as W;
    w.ruleset.rules.reverse();
    w.ruleset.conditions.ref_name = { include: ["~DEFAULT_BRANCH"], exclude: [] };
    const { o } = check(w);
    expect(o.code).toBe(0);
  });
});

describe("--check: bypass list", () => {
  it("a live ruleset with no bypass_actors field gets a notice and no ok: a caller without admin rights must not see a false green", () => {
    const w = sync() as W;
    delete w.ruleset.bypass_actors;
    const { o } = check(w);
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "notice")).toEqual([
      'notice: ruleset "default-branch" bypass list cannot be read without admin rights; not checked',
    ]);
    expect(lines(o.stdout, "ok").join("\n")).not.toContain('ruleset "default-branch"');
  });

  it("other drift still reports when the bypass list is hidden", () => {
    const w = sync() as W;
    delete w.ruleset.bypass_actors;
    w.ruleset.enforcement = "disabled";
    const { o } = check(w);
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "drift")).toHaveLength(1);
  });
});

describe("--check: drift", () => {
  const rule = (ruleset: LiveRuleset, type: string) => ruleset.rules.find((r) => r.type === type)?.parameters as NonNullable<LiveRuleset["rules"][number]["parameters"]>;

  // [regression it catches, change to the live world, text the one drift line must contain]
  const cases: [string, (w: W) => void, string[]][] = [
    ["enforcement disabled: a switched-off ruleset protects nothing", (w) => (w.ruleset.enforcement = "disabled"), ["enforcement", '"active"', '"disabled"']],
    [
      "a bypass actor added: someone can skip every rule",
      (w) => w.ruleset.bypass_actors?.push({ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }),
      ["bypass_actors", "declared []", "actor_id"],
    ],
    [
      "a required check removed: a red build could merge",
      (w) => rule(w.ruleset, "required_status_checks").required_status_checks.pop(),
      ["required_status_checks", "E2E smoke (Playwright)"],
    ],
    [
      "a rule type removed: force pushes could return",
      (w) => (w.ruleset.rules = w.ruleset.rules.filter((r) => r.type !== "non_fast_forward")),
      ["rules.non_fast_forward", "live absent"],
    ],
    ["an extra rule type added by hand", (w) => w.ruleset.rules.push({ type: "required_signatures" }), ["rules.required_signatures", "live present"]],
    [
      "required_approving_review_count changed: the one human-review setting must match the file",
      (w) => (rule(w.ruleset, "pull_request").required_approving_review_count = 2),
      ["required_approving_review_count", "declared 0", "live 2"],
    ],
    ["the include pattern changed: the rules would guard the wrong branch", (w) => (w.ruleset.conditions.ref_name.include = ["refs/heads/dev"]), ["conditions.ref_name.include"]],
    [
      "production takes squash too: a release would stop being a merge commit of staging",
      (w) => (rule(w.production, "pull_request").allowed_merge_methods = ["merge", "squash"]),
      ['ruleset "production"', "allowed_merge_methods", '["merge"]'],
    ],
    [
      "the production guard check removed: a pull request from any branch could reach production",
      (w) => rule(w.production, "required_status_checks").required_status_checks.shift(),
      ['ruleset "production"', "required_status_checks", GUARD],
    ],
    [
      "the production guard check bound to another app: a fake status could satisfy it",
      (w) => Object.assign(rule(w.production, "required_status_checks").required_status_checks[0] ?? {}, { integration_id: 1 }),
      ['ruleset "production"', "required_status_checks", "(app 1)"],
    ],
    [
      "linear history added to production by hand: the merge commit from staging would be refused",
      (w) => w.production.rules.push({ type: "required_linear_history" }),
      ['ruleset "production"', "rules.required_linear_history", "live present"],
    ],
    [
      "production enforcement disabled: releases would take any push",
      (w) => (w.production.enforcement = "disabled"),
      ['ruleset "production"', "enforcement", '"disabled"'],
    ],
    ["a reviewer removed: deploys would need no approval", (w) => (w.env.protection_rules[0].reviewers = []), ["reviewers", "@owner"]],
    ["prevent_self_review flipped", (w) => (w.env.protection_rules[0].prevent_self_review = true), ["prevent_self_review", "declared false", "live true"]],
    [
      "the deployment policy switched to protected branches only",
      (w) => (w.env.deployment_branch_policy = { protected_branches: true, custom_branch_policies: false }),
      ["deployment_branch_policy"],
    ],
    [
      "a deployment branch added: a feature branch could deploy to production",
      (w) => w.policies?.branch_policies.push({ id: 12, name: "feature/x", type: "branch" }),
      ["deployment_branches", "feature/x"],
    ],
    ["a deployment branch removed: main could not deploy", (w) => (w.policies = null), ["deployment_branches", "[]"]],
  ];

  it.each(cases)("%s", (_name, mutate, needles) => {
    const w = sync() as W;
    mutate(w);
    const { o } = check(w);
    expect(o.code).toBe(1);
    const d = lines(o.stdout, "drift");
    expect(d).toHaveLength(1);
    for (const n of needles) expect(d[0]).toContain(n);
  });

  it("drift in production only is reported by that ruleset's name and never blames default-branch", () => {
    const w = sync() as W;
    w.production.enforcement = "disabled";
    const { o } = check(w);
    expect(lines(o.stdout, "ok")).toContain('ok: ruleset "default-branch" matches .github/repo-rules.json');
    expect(lines(o.stdout, "drift").join("\n")).not.toContain("default-branch");
  });

  it("drift in default-branch only does not touch the production line", () => {
    const w = sync() as W;
    w.ruleset.enforcement = "disabled";
    const { o } = check(w);
    expect(lines(o.stdout, "ok")).toContain('ok: ruleset "production" matches .github/repo-rules.json');
    expect(lines(o.stdout, "drift")).toHaveLength(1);
    expect(lines(o.stdout, "drift")[0]).toContain('ruleset "default-branch"');
  });

  it("a live check with no integration_id passes when the file does not pin one: default-branch checks carry none", () => {
    const w = sync() as W;
    for (const c of rule(w.ruleset, "required_status_checks").required_status_checks) c.integration_id = 99;
    const { o } = check(w);
    expect(o.code).toBe(0);
  });
});

// ---------------------------------------------------------------- apply

describe("--apply --dry-run", () => {
  it("prints would: lines and makes no write call: a dry run must never change the repo", () => {
    const { o, calls } = check({ ruleset: null, env: null }, ["--apply", "--dry-run"]);
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "would").map((l) => l.split(" ").slice(0, 3).join(" "))).toEqual([
      `would: POST ${BASE}/rulesets`,
      `would: POST ${BASE}/rulesets`,
      `would: PUT ${BASE}/environments/production`,
      `would: POST ${BASE}/environments/production/deployment-branch-policies`,
    ]);
    expect(lines(o.stdout, "did")).toEqual([]);
    expect(calls.filter((c) => c.args.includes("-X"))).toEqual([]);
    expect(calls.every((c) => c.input === undefined)).toBe(true);
  });

  it("puts the compact JSON body after the path", () => {
    const { o } = check({ ruleset: null, env: null }, ["--apply", "--dry-run"]);
    expect(lines(o.stdout, "would")[3]).toBe(
      `would: POST ${BASE}/environments/production/deployment-branch-policies {"name":"main","type":"branch"}`,
    );
  });
});

describe("--apply", () => {
  it("from nothing: POST both rulesets, PUT environment, POST branch policy, in that order, with the right bodies", () => {
    const { o, calls } = check({ ruleset: null, env: null }, ["--apply"]);
    expect(o.code).toBe(0);
    const w = writes(calls);
    expect(w.map((c) => c.args.slice(1))).toEqual([
      ["-X", "POST", `${BASE}/rulesets`, "--input", "-"],
      ["-X", "POST", `${BASE}/rulesets`, "--input", "-"],
      ["-X", "PUT", `${BASE}/environments/production`, "--input", "-"],
      ["-X", "POST", `${BASE}/environments/production/deployment-branch-policies`, "--input", "-"],
    ]);
    expect(JSON.parse(w[0]?.input ?? "")).toEqual(DEFAULT_BRANCH_DECLARED);
    expect(JSON.parse(w[1]?.input ?? "")).toEqual(PRODUCTION_DECLARED);
    expect(JSON.parse(w[2]?.input ?? "")).toEqual({
      prevent_self_review: false,
      reviewers: [{ type: "User", id: 42 }],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    });
    expect(JSON.parse(w[3]?.input ?? "")).toEqual({ name: "main", type: "branch" });
    expect(lines(o.stdout, "did")).toHaveLength(4);
  });

  it("on a repo with only default-branch it POSTs production and leaves the first ruleset alone: a fork that applied before this change catches up", () => {
    const { o, calls } = check({ ...sync(), production: null }, ["--apply"]);
    expect(o.code).toBe(0);
    const made = writes(calls);
    expect(made.map((c) => c.args.slice(2, 4))).toEqual([["POST", `${BASE}/rulesets`]]);
    expect(JSON.parse(made[0]?.input ?? "{}")).toEqual(PRODUCTION_DECLARED);
  });

  it("run twice, the second apply writes nothing: the first apply's result is what the file declares", () => {
    const first = check({ ...sync(), production: null }, ["--apply"]);
    expect(writes(first.calls)).toHaveLength(1);
    const second = check(sync(), ["--apply"]);
    expect(writes(second.calls)).toEqual([]);
    expect(second.o.stdout.join("\n")).toContain("nothing needs to change");
  });

  it("when the repo already matches it makes no write call: running apply twice is safe", () => {
    const { o, calls } = check(sync(), ["--apply"]);
    expect(o.code).toBe(0);
    expect(writes(calls)).toEqual([]);
    expect(o.stdout.join("\n")).toContain("nothing needs to change");
  });

  it("a drifted ruleset is replaced with PUT on its id, and nothing else is written", () => {
    const w = sync() as W;
    w.ruleset.enforcement = "disabled";
    const { calls, o } = check(w, ["--apply"]);
    expect(o.code).toBe(0);
    expect(writes(calls).map((c) => c.args.slice(2, 4))).toEqual([["PUT", `${BASE}/rulesets/7`]]);
  });

  it("drifted branch policies: POST the missing one, DELETE the extra one by id, and leave the environment alone", () => {
    const w = sync() as W;
    w.policies = { branch_policies: [{ id: 12, name: "old", type: "branch" }] };
    const { calls, o } = check(w, ["--apply"]);
    expect(o.code).toBe(0);
    const made = writes(calls);
    expect(made.map((c) => c.args.slice(2, 4))).toEqual([
      ["POST", `${BASE}/environments/production/deployment-branch-policies`],
      ["DELETE", `${BASE}/environments/production/deployment-branch-policies/12`],
    ]);
    expect(JSON.parse(made[0]?.input ?? "")).toEqual({ name: "main", type: "branch" });
    expect(made[1]?.input).toBeUndefined();
  });

  it("a named reviewer resolves through users/<login>, a team through orgs/<org>/teams/<slug>", () => {
    const declared = JSON.parse(JSON.stringify(DECLARED));
    declared.environments[0].reviewers = ["octocat", "acme/core"];
    const { calls } = check(
      {
        ruleset: clone(LIVE_RULESET),
        production: clone(LIVE_PRODUCTION),
        env: null,
        override: (_m, path) => {
          if (path === "users/octocat") return json({ id: 1, login: "octocat" });
          if (path === "orgs/acme/teams/core") return json({ id: 9, slug: "core" });
        },
      },
      ["--apply"],
      { files: files({ ".github/repo-rules.json": JSON.stringify(declared) }) },
    );
    const put = writes(calls).find((c) => c.args[2] === "PUT");
    expect(JSON.parse(put?.input ?? "").reviewers).toEqual([
      { type: "User", id: 1 },
      { type: "Team", id: 9 },
    ]);
  });

  it("an unknown reviewer login is an error before any write", () => {
    const declared = JSON.parse(JSON.stringify(DECLARED));
    declared.environments[0].reviewers = ["ghost"];
    const { o, calls } = check(
      { ruleset: null, env: null, override: (_m, path) => (path === "users/ghost" ? notFound : undefined) },
      ["--apply"],
      { files: files({ ".github/repo-rules.json": JSON.stringify(declared) }) },
    );
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain('reviewer "ghost"');
    expect(writes(calls)).toEqual([]);
  });

  it("@owner on an organisation-owned repo is an error telling the user to list a user or team", () => {
    const { o, calls } = check({ ruleset: null, env: null, owner: { login: "acme", id: 3, type: "Organization" } }, ["--apply"]);
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("list a user or team in .github/repo-rules.json");
    expect(writes(calls)).toEqual([]);
  });

  it("@owner on an organisation fails --check too: the file cannot be satisfied", () => {
    const { o } = check({ ruleset: null, env: null, owner: { login: "acme", id: 3, type: "Organization" } });
    expect(o.code).toBe(1);
  });

  it("a failed write stops the run and a 403 adds the admin hint: no later write runs on a half-applied repo", () => {
    const { o, calls } = check(
      {
        ruleset: null,
        env: null,
        override: (m, path) => (m === "POST" && path.endsWith("/rulesets") ? { code: 1, stderr: "gh: Resource not accessible (HTTP 403)" } : undefined),
      },
      ["--apply"],
    );
    expect(o.code).toBe(1);
    expect(writes(calls)).toHaveLength(1);
    expect(lines(o.stdout, "error")).toHaveLength(1);
    expect(lines(o.stdout, "error")[0]).toContain(`POST ${BASE}/rulesets failed`);
    expect(lines(o.stdout, "error")[0]).toContain("admin rights");
    expect(lines(o.stdout, "did")).toEqual([]);
  });

  it("a 422 on the environment PUT hints at the paid plan", () => {
    const { o } = check(
      {
        ruleset: clone(LIVE_RULESET),
        production: clone(LIVE_PRODUCTION),
        env: null,
        override: (m, path) =>
          m === "PUT" && path.includes("/environments/") ? { code: 1, stderr: "gh: Validation Failed (HTTP 422)" } : undefined,
      },
      ["--apply"],
    );
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("paid GitHub plan");
  });
});

// ---------------------------------------------------------------- annotations and usage

describe("GITHUB_ACTIONS", () => {
  it("adds ::notice:: for each notice and ::error:: for each drift or error, so the run page shows them", () => {
    const notices = check({ ruleset: null, env: null }, ["--check"], { env: { GITHUB_ACTIONS: "true" } }).o;
    expect(notices.stdout.filter((l) => l.startsWith("::notice::"))).toHaveLength(3);

    const drift = check({ ruleset: clone(LIVE_RULESET), production: clone(LIVE_PRODUCTION), env: null }, ["--check"], { env: { GITHUB_ACTIONS: "true" } }).o;
    expect(drift.stdout.filter((l) => l.startsWith("::error::"))).toHaveLength(1);

    const bad = check({}, ["--check"], { env: { GITHUB_ACTIONS: "true" }, files: {} }).o;
    expect(bad.stdout.some((l) => l.startsWith("::error::cannot read"))).toBe(true);
  });

  it("prints no annotations outside Actions", () => {
    const { o } = check({ ruleset: null, env: null });
    expect(o.stdout.some((l) => l.startsWith("::"))).toBe(false);
  });
});

describe("usage", () => {
  const code = (argv: string[]) => {
    const h = harness(sync());
    const o = run(argv, h.deps);
    return { o, calls: h.calls };
  };

  it.each([
    ["no mode", []],
    ["--check with --apply: two modes would be ambiguous", ["--check", "--apply"]],
    ["an unknown flag: a typo of --dry-run must not run a real apply", ["--apply", "--dryrun"]],
    ["--strict is gone: a stale CI line must fail loudly, not run silently", ["--check", "--strict"]],
    ["--dry-run with --check", ["--check", "--dry-run"]],
  ])("%s exits 2 with usage on stderr and calls nothing", (_name, argv) => {
    const { o, calls } = code(argv);
    expect(o.code).toBe(2);
    expect(o.stderr.join("\n")).toContain("usage:");
    expect(o.stdout).toEqual([]);
    expect(calls).toEqual([]);
  });
});
