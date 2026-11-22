import { Either } from "effect";
import { describe, it, expect } from "vitest";
import { run, type Deps, type GhResult } from "../repo-rules";

const REPO = "acme/saas";
const BASE = `repos/${REPO}`;
const OLD_CHECK = "Build (Cloudflare Workers)";
const NEW_CHECK = "PR title (Conventional Commits)";
const REASON = "apply when the release lands";
const REPO_REASON = "the owner applies it with the check";

interface Setup {
  checkReason?: unknown;
  repository?: Record<string, unknown> | null;
  liveChecks?: string[];
  liveEnforcement?: string;
  liveTitle?: string;
  noRuleset?: boolean;
  jobs?: string[];
}

const declared = (s: Setup) => ({
  rulesets: [
    {
      name: "default-branch",
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [
        { type: "deletion" },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              { context: OLD_CHECK },
              { context: NEW_CHECK, ...("checkReason" in s ? { pending: s.checkReason } : { pending: REASON }) },
            ],
          },
        },
      ],
    },
  ],
  environments: [],
  ...(s.repository === null ? {} : { repository: s.repository ?? { squash_merge_commit_title: "PR_TITLE", pending: REPO_REASON } }),
});

const liveRuleset = (s: Setup) => ({
  id: 7,
  name: "default-branch",
  target: "branch",
  enforcement: s.liveEnforcement ?? "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    {
      type: "required_status_checks",
      parameters: { required_status_checks: (s.liveChecks ?? [OLD_CHECK]).map((context) => ({ context, integration_id: 15368 })) },
    },
  ],
});

const workflow = (names: string[]) =>
  ["name: CI", "jobs:", ...names.flatMap((n, i) => [`  j${i}:`, `    name: ${n}`])].join("\n");

interface Call {
  args: string[];
  input?: string;
}

function harness(s: Setup, config: unknown = declared(s)) {
  const calls: Call[] = [];
  const files: Record<string, string> = {
    ".github/repo-rules.json": JSON.stringify(config),
    ".github/workflows/ci.yml": workflow(s.jobs ?? [OLD_CHECK, NEW_CHECK]),
  };
  const reply = (r: Partial<GhResult>): GhResult => ({ code: 0, stdout: "", stderr: "", ...r });
  const deps: Deps = {
    gh: (args, input) => {
      calls.push({ args, input });
      if (args[1] === "-X") return reply({ stdout: "{}" });
      const path = args[1];
      if (path === BASE)
        return reply({
          stdout: JSON.stringify({
            default_branch: "main",
            owner: { login: "acme-owner", id: 42, type: "User" },
            permissions: { admin: true },
            ...(s.liveTitle === undefined ? {} : { squash_merge_commit_title: s.liveTitle }),
          }),
        });
      if (path === `${BASE}/rulesets?per_page=100&includes_parents=false`)
        return reply({ stdout: JSON.stringify(s.noRuleset ? [] : [{ id: 7, name: "default-branch" }]) });
      if (path === `${BASE}/rulesets/7`) return reply({ stdout: JSON.stringify(liveRuleset(s)) });
      return reply({ code: 1, stderr: `unexpected gh call: ${args.join(" ")}` });
    },
    readFile: (p) => (p in files ? Either.right(files[p] ?? "") : Either.left("ENOENT")),
    listDir: (dir) => {
      const names = Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1));
      return names.length ? Either.right(names) : Either.left("ENOENT");
    },
    env: { GITHUB_REPOSITORY: REPO },
  };
  return { deps, calls };
}

const go = (s: Setup, argv: string[] = ["--check"], config?: unknown) => {
  const h = harness(s, config);
  return { ...h, o: run(argv, h.deps) };
};
const lines = (stdout: string[], kind: string) => stdout.filter((l) => l.startsWith(`${kind}: `));
const writes = (calls: Call[]) => calls.filter((c) => c.args.includes("-X"));
const inSync: Setup = { liveChecks: [OLD_CHECK, NEW_CHECK], liveTitle: "PR_TITLE" };

describe("--check with pending items", () => {
  it("a pending check missing live is a notice and the ruleset is ok: the gate was red for every branch until the owner applied a rule that cannot be applied yet", () => {
    const { o } = go({ liveTitle: "PR_TITLE" });
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "ok")).toContain('ok: ruleset "default-branch" matches .github/repo-rules.json');
    const notices = lines(o.stdout, "notice");
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain(`check "${NEW_CHECK}"`);
    expect(notices[0]).toContain(REASON);
  });

  it("a pending check present live is ok with a notice that the mark can go", () => {
    const { o } = go(inSync);
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "ok")).toContain('ok: ruleset "default-branch" matches .github/repo-rules.json');
    expect(lines(o.stdout, "notice").join("\n")).toContain(`check "${NEW_CHECK}" is live; delete its "pending" mark`);
    expect(lines(o.stdout, "drift")).toEqual([]);
  });

  it("a non-pending difference in the same ruleset is still drift: a pending check must not switch drift detection off", () => {
    const { o } = go({ liveEnforcement: "evaluate" });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "drift")).toEqual(['drift: ruleset "default-branch" enforcement: declared "active", live "evaluate"']);
  });

  it("a live check that is not declared is still drift beside a pending one", () => {
    const { o } = go({ liveChecks: [OLD_CHECK, "Hand added"] });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "drift")[0]).toContain("Hand added");
  });
});

describe("--check: the repository section", () => {
  it("a live title that GitHub does not show is a notice, never drift", () => {
    const { o } = go({ liveChecks: [OLD_CHECK, NEW_CHECK] });
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "notice").join("\n")).toContain("squash_merge_commit_title cannot be read with this token");
  });

  it("a different live title without pending is drift: a hand change must show", () => {
    const { o } = go({ ...inSync, liveTitle: "COMMIT_OR_PR_TITLE" }, ["--check"], declared({ repository: { squash_merge_commit_title: "PR_TITLE" } }));
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "drift")).toEqual(['drift: repository squash_merge_commit_title: declared "PR_TITLE", live "COMMIT_OR_PR_TITLE"']);
  });

  it("a different live title with pending is a notice that names the reason", () => {
    const { o } = go({ ...inSync, liveTitle: "COMMIT_OR_PR_TITLE" });
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "notice").join("\n")).toContain(REPO_REASON);
  });

  it("a pending title already live is ok with the remove-the-mark notice", () => {
    const { o } = go(inSync);
    expect(lines(o.stdout, "ok").join("\n")).toContain("repository squash_merge_commit_title matches");
    expect(lines(o.stdout, "notice").join("\n")).toContain("repository squash_merge_commit_title is live; delete its");
  });

  it("with no rule applied yet a different title is a notice, so a fresh fork stays green", () => {
    const { o } = go({ noRuleset: true, liveTitle: "COMMIT_OR_PR_TITLE" }, ["--check"], declared({ repository: { squash_merge_commit_title: "PR_TITLE" } }));
    expect(o.code).toBe(0);
    expect(lines(o.stdout, "drift")).toEqual([]);
    expect(lines(o.stdout, "notice").join("\n")).toContain("declared \"PR_TITLE\", live \"COMMIT_OR_PR_TITLE\"");
  });
});

describe("--apply with pending items", () => {
  it("a repo that lacks the pending check gets it in the PUT, and no pending mark reaches the body", () => {
    const { o, calls } = go({ liveTitle: "PR_TITLE" }, ["--apply"]);
    expect(o.code).toBe(0);
    const [put] = writes(calls);
    expect(put?.args).toEqual(["api", "-X", "PUT", `${BASE}/rulesets/7`, "--input", "-"]);
    expect(put?.input).toContain(NEW_CHECK);
    expect(put?.input).not.toContain("pending");
    expect(lines(o.stdout, "notice").join("\n")).toContain('delete their "pending" marks');
  });

  it("a missing ruleset is created with the pending check and no mark", () => {
    const { calls } = go({ noRuleset: true, liveTitle: "PR_TITLE" }, ["--apply"]);
    const [post] = writes(calls);
    expect(post?.args.slice(1, 4)).toEqual(["-X", "POST", `${BASE}/rulesets`]);
    expect(post?.input).toContain(NEW_CHECK);
    expect(post?.input).not.toContain("pending");
  });

  it("a different title is set with one PATCH that carries only the declared key", () => {
    const { calls } = go({ ...inSync, liveTitle: "COMMIT_OR_PR_TITLE" }, ["--apply"]);
    const sent = writes(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.args).toEqual(["api", "-X", "PATCH", BASE, "--input", "-"]);
    expect(JSON.parse(sent[0]?.input ?? "{}")).toEqual({ squash_merge_commit_title: "PR_TITLE" });
  });

  it("a second apply on a repo that now matches writes nothing", () => {
    const { o, calls } = go(inSync, ["--apply"]);
    expect(writes(calls)).toEqual([]);
    expect(lines(o.stdout, "ok").join("\n")).toContain("nothing needs to change");
    expect(lines(o.stdout, "notice")).toEqual([]);
  });

  it("a dry run lists the ruleset update and the repository PATCH and writes nothing", () => {
    const { o, calls } = go({ liveTitle: "COMMIT_OR_PR_TITLE" }, ["--apply", "--dry-run"]);
    expect(writes(calls)).toEqual([]);
    const would = lines(o.stdout, "would");
    expect(would).toHaveLength(2);
    expect(would[0]).toContain(`PUT ${BASE}/rulesets/7`);
    expect(would[1]).toBe(`would: PATCH ${BASE} {"squash_merge_commit_title":"PR_TITLE"}`);
    expect(lines(o.stdout, "notice")).toEqual(["notice: the writes listed above include pending items; nothing was written"]);
  });
});

describe("config errors for pending", () => {
  it.each([
    ["an empty string", ""],
    ["a blank string", "   "],
    ["a number", 5],
    ["true", true],
  ])("a check with pending set to %s is an error before any gh call: a mark with no reason must not hide a check", (_n, value) => {
    const { o, calls } = go({ checkReason: value });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain(`check "${NEW_CHECK}"`);
    expect(calls).toEqual([]);
  });

  it.each([
    ["a string", "Build"],
    ["an object", { context: "Build" }],
    ["null", null],
  ])("required_status_checks set to %s is an error that names the ruleset, with no gh call, in --check and --apply: it must never apply as an empty check list", (_n, value) => {
    const config = declared({});
    const params = config.rulesets[0]?.rules[1]?.parameters as Record<string, unknown>;
    params.required_status_checks = value;
    for (const argv of [["--check"], ["--apply"]]) {
      const { o, calls } = go({}, argv, config);
      expect(o.code).toBe(1);
      expect(lines(o.stdout, "error")).toEqual(['error: ruleset "default-branch" required_status_checks must be a list of checks']);
      expect(calls).toEqual([]);
    }
  });

  it("a required_status_checks rule with no checks parameter is not an error and its body is sent as written", () => {
    const config = declared({});
    const rule = config.rulesets[0]?.rules[1];
    if (rule) rule.parameters = { strict_required_status_checks_policy: false } as never;
    const { o, calls } = go({ liveTitle: "PR_TITLE" }, ["--apply"], config);
    expect(lines(o.stdout, "error")).toEqual([]);
    expect(o.code).toBe(0);
    const put = writes(calls)[0];
    expect(put?.input).not.toContain('"required_status_checks":[');
  });

  it("a repository with an empty pending is an error", () => {
    const { o, calls } = go({ repository: { squash_merge_commit_title: "PR_TITLE", pending: "" } });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")[0]).toContain("is not valid");
    expect(calls).toEqual([]);
  });

  it("a pending check that is no job in any workflow fails the offline check: the check would never report and would hang every pull request", () => {
    const { o, calls } = go({ jobs: [OLD_CHECK] });
    expect(o.code).toBe(1);
    expect(lines(o.stdout, "error")).toEqual([
      `error: required check "${NEW_CHECK}" is not a job name in any workflow under .github/workflows`,
    ]);
    expect(calls).toEqual([]);
  });
});
