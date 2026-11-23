import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { evaluate, jobsOf, jobsThatRun, type Context } from "./helpers/workflow-jobs";

const ROOT = path.join(__dirname, "..", "..");
const DIR = path.join(ROOT, ".github", "workflows");
const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf-8");

/** Lines of a workflow with comment-only lines removed. */
const codeLines = (f: string) =>
  read(f)
    .split("\n")
    .filter((l) => !/^\s*#/.test(l));

describe("workflows pin Bun in one place", () => {
  it(".bun-version holds one plain version: setup-bun reads it as is", () => {
    expect(fs.readFileSync(path.join(ROOT, ".bun-version"), "utf-8")).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it.each(files)("%s: no bun-version: key, and every setup-bun step reads .bun-version (a second pin lets deploy drift from CI)", (f) => {
    const lines = codeLines(f);
    expect(lines.filter((l) => /^\s*-?\s*bun-version\s*:/.test(l))).toEqual([]);
    const steps = lines.flatMap((line, i) => (/uses:\s*oven-sh\/setup-bun@/.test(line) ? [lines.slice(i, i + 4).join("\n")] : []));
    for (const step of steps) {
      expect(step).toMatch(/bun-version-file:\s*\.bun-version\b/);
    }
  });
});

describe("workflows pin every action to a commit", () => {
  it.each(files)("%s: every uses: is owner/repo@<40 hex> # v<version> (a tag can be moved to run other code)", (f) => {
    const uses = codeLines(f).filter((l) => /^\s*-?\s*uses\s*:/.test(l));
    for (const line of uses) {
      expect(line.trim()).toMatch(/^(- )?uses:\s+[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40} # v\d+(\.\d+){1,2}$/);
    }
  });

  it.each(files)("%s: every actions/checkout step sets persist-credentials: false (the job token stays out of .git/config)", (f) => {
    const lines = codeLines(f);
    lines.forEach((line, i) => {
      if (!/uses:\s*actions\/checkout@/.test(line)) return;
      const indent = line.length - line.trimStart().length;
      const step: string[] = [];
      for (const next of lines.slice(i + 1)) {
        const nextIndent = next.length - next.trimStart().length;
        if (next.trim() !== "" && nextIndent <= indent) break;
        step.push(next);
      }
      expect(step.join("\n")).toMatch(/^\s+persist-credentials:\s*false\s*$/m);
    });
  });
});

describe("workflows hold least-privilege permissions", () => {
  it.each(files)("%s: the top-level permissions block has contents: read and nothing else (a job asks for more itself)", (f) => {
    const lines = codeLines(f);
    const start = lines.findIndex((l) => /^permissions:\s*$/.test(l));
    expect(start, "no top-level permissions: block").toBeGreaterThanOrEqual(0);
    const block: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() !== "" && !/^\s/.test(line)) break;
      if (line.trim() !== "") block.push(line.trim());
    }
    expect(block).toEqual(["contents: read"]);
  });

  it.each(files)("%s: no write-all anywhere", (f) => {
    expect(codeLines(f).filter((l) => /write-all/.test(l))).toEqual([]);
  });

  it("codeql.yml gives security-events: write to its analyze job only", () => {
    const writes = codeLines("codeql.yml").filter((l) => /^\s+security-events:\s*write/.test(l));
    expect(writes).toHaveLength(1);
  });

  it("preview.yml gives pull-requests: write at job level, never at the top", () => {
    const lines = codeLines("preview.yml").filter((l) => /pull-requests:\s*write/.test(l));
    expect(lines).toHaveLength(1);
    const [first = ""] = lines;
    expect(first.length - first.trimStart().length).toBeGreaterThan(2);
  });
});

describe(".github/dependabot.yml", () => {
  const text = fs.readFileSync(path.join(ROOT, ".github", "dependabot.yml"), "utf-8");
  const code = text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  it.each(["bun", "github-actions"])("has a weekly %s entry with groups (without groups every package is its own pull request)", (ecosystem) => {
    const entries = code.split(/^\s*- package-ecosystem:/m).slice(1);
    const entry = entries.find((e) => e.trim().startsWith(`"${ecosystem}"`) || e.trim().startsWith(ecosystem));
    expect(entry, `no ${ecosystem} entry`).toBeDefined();
    expect(entry).toMatch(/interval:\s*"?weekly"?/);
    expect(entry).toMatch(/^\s+groups:\s*$/m);
  });

  it("is version 2", () => {
    expect(code).toMatch(/^version:\s*2\s*$/m);
  });
});

describe("workflows keep secrets and PR data out of shell text", () => {
  it.each(["deploy.yml", "deploy-staging.yml", "preview.yml", "preview-cleanup.yml"])(
    "%s has no ${{ }} expression inside a run script: PR-controlled values must go through env",
    (f) => {
      const lines = codeLines(f);
      let runIndent: number | undefined;
      const offenders: string[] = [];
      for (const line of lines) {
        const indent = line.length - line.trimStart().length;
        if (runIndent !== undefined && line.trim() !== "" && indent <= runIndent) runIndent = undefined;
        if (runIndent !== undefined && /\$\{\{/.test(line)) offenders.push(line.trim());
        const m = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
        if (m) {
          if (/\$\{\{/.test(m[2] ?? "")) offenders.push(line.trim());
          if (m[2] === "|" || m[2] === ">" || m[2] === ">-" || m[2] === "|-") runIndent = indent;
        }
      }
      expect(offenders).toEqual([]);
    },
  );

  it("deploy.yml records the restore point before it applies migrations: a backup after the schema change is no way back", () => {
    const lines = codeLines("deploy.yml");
    const backup = lines.findIndex((l) => /scripts\/ci\/d1-backup\.ts/.test(l));
    const migrate = lines.findIndex((l) => /db:migrate:remote/.test(l));
    expect(backup).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(backup).toBeLessThan(migrate);
  });

  it.each(["preview.yml", "preview-cleanup.yml"])("%s never names the production token: jobs that run PR code must not read it", (f) => {
    const uses = codeLines(f).filter((l) => /secrets\.CLOUDFLARE_API_TOKEN\b/.test(l));
    // The readiness job may test whether it is set (it sees a boolean, not the value).
    for (const line of uses) {
      expect(line).toMatch(/PROD_TOKEN_AT_REPO_LEVEL:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN != ''\s*\}\}/);
    }
  });

  it("deploy.yml gives the token only to steps, never at job level", () => {
    const tokenLines = codeLines("deploy.yml").filter((l) => /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\./.test(l));
    expect(tokenLines.length).toBeGreaterThan(0);
    for (const line of tokenLines) {
      // Step-level env sits at 10 spaces; job-level env at 6.
      expect(line.length - line.trimStart().length).toBeGreaterThanOrEqual(10);
    }
  });
});

describe("pr-title.yml checks the title with the repo's commitlint config", () => {
  const lines = codeLines("pr-title.yml");
  const text = lines.join("\n");

  it("runs on opened, edited, synchronize and reopened: an edited title must be checked again", () => {
    expect(text).toMatch(/pull_request:\s*\n\s+types:\s*\[opened, edited, synchronize, reopened\]/);
  });

  it("has no branches filter: a stacked PR targets the PR below it", () => {
    expect(text).not.toMatch(/^\s{4}branches:/m);
  });

  it("never uses pull_request_target: it would run PR code with secrets", () => {
    expect(text).not.toMatch(/pull_request_target/);
  });

  it("reads the title only inside an env: block: a title such as $(rm -rf ~) must never reach shell text", () => {
    const uses = lines.flatMap((line, i) => (/github\.event\.pull_request\.title/.test(line) ? [i] : []));
    expect(uses).toHaveLength(1);
    const at = uses[0] ?? 0;
    expect(lines[at]).toMatch(/^\s+PR_TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}\s*$/);
    expect(lines[at - 1]).toMatch(/^\s+env:\s*$/);
  });

  it("names the job exactly 'PR title (Conventional Commits)': a ruleset will require it by that name", () => {
    expect(text).toMatch(/^\s+name: PR title \(Conventional Commits\)\s*$/m);
  });

  it("installs with --ignore-scripts: the install must not run the prepare script or a dependency's hook", () => {
    const installs = lines.filter((l) => /bun install/.test(l));
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain("--frozen-lockfile --ignore-scripts");
  });

  it("lints on stdin with the local commitlint: no title in argv, no package fetched at run time", () => {
    expect(text).toContain(`printf '%s\\n' "$PR_TITLE" | bunx --no-install commitlint`);
  });

  it("uses the title config, which refuses merge-shaped titles: squashed, such a title is a subject with no type", () => {
    expect(text).toContain("commitlint --config .commitlintrc.title.json");
  });
});

describe("deploys tell the Worker its release version and environment", () => {
  const deploy = codeLines("deploy.yml").join("\n");
  const preview = codeLines("preview.yml").join("\n");

  it("deploy.yml names the release first, then passes it and the environment to wrangler deploy: without them every error report says unversioned", () => {
    expect(deploy).toMatch(/RELEASE_VERSION:\s*\$\{\{\s*steps\.release\.outputs\.version\s*\}\}/);
    expect(deploy).toContain('bunx wrangler deploy --var "RELEASE_VERSION:$RELEASE_VERSION" --var ENVIRONMENT:production');
    const naming = deploy.indexOf("bun scripts/ci/release-version.ts");
    expect(naming).toBeGreaterThan(-1);
    expect(naming).toBeLessThan(deploy.indexOf("bunx wrangler deploy"));
  });

  it("deploy.yml names the release from the tested commit and gives that step only the read-only repo token", () => {
    expect(deploy).toContain('bun scripts/ci/release-version.ts "$DEPLOY_SHA" >> "$GITHUB_OUTPUT"');
    expect(deploy).toMatch(/GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
    const releaseStep = deploy.slice(deploy.indexOf("- name: Name the release"), deploy.indexOf("- name: Deploy to Cloudflare Workers"));
    expect(releaseStep).not.toContain("CLOUDFLARE_API_TOKEN");
  });

  it("preview.yml passes the PR head sha and the name preview: a preview's reports must not read as production", () => {
    expect(preview).toContain('--var "RELEASE_VERSION:$HEAD_SHA" --var ENVIRONMENT:preview');
    expect(preview).toMatch(/HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  });
});

describe("workflows follow the staging to production flow", () => {
  const pushBranches = (f: string): string[] => {
    const lines = codeLines(f);
    const push = lines.findIndex((l) => /^ {2}push:\s*$/.test(l));
    expect(push, `${f} has no push: trigger`).toBeGreaterThanOrEqual(0);
    const match = lines
      .slice(push + 1, push + 3)
      .join("\n")
      .match(/branches:\s*\[([^\]]*)\]/);
    expect(match, `${f} push: has no branches list`).not.toBeNull();
    return (match?.[1] ?? "").split(",").map((b) => b.trim());
  };

  const flow = (): { integration: string; release: string } => {
    const [integration = "", release = ""] = pushBranches("ci.yml");
    return { integration, release };
  };
  const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  it("ci.yml pushes to two branches, the one pull requests land on and the one that releases, and codeql.yml to the same two (a drift leaves one scan off a branch; a fork may rename both)", () => {
    const ci = pushBranches("ci.yml");
    expect(ci).toHaveLength(2);
    expect(ci[0]).not.toBe(ci[1]);
    expect(pushBranches("codeql.yml")).toEqual(ci);
  });

  it.each(["ci.yml", "codeql.yml"])("%s still runs on every pull request: a stacked PR targets the PR below it, not a protected branch", (f) => {
    const lines = codeLines(f);
    const pr = lines.findIndex((l) => /^ {2}pull_request:\s*$/.test(l));
    expect(pr).toBeGreaterThanOrEqual(0);
    expect(lines[pr + 1] ?? "").not.toMatch(/^\s{4}branches:/);
  });

  it("deploy.yml follows CI on the release branch only (a deploy off the branch pull requests land on would ship every squash)", () => {
    const text = codeLines("deploy.yml").join("\n");
    const match = text.match(/workflow_run:\s*\n\s+workflows:\s*\[CI\]\s*\n\s+types:\s*\[completed\]\s*\n\s+branches:\s*\[([^\]]*)\]\s*\n/);
    expect(match?.[1]?.trim()).toBe(flow().release);
  });

  it("release.yml triggers on pushes to the release branch only", () => {
    expect(pushBranches("release.yml")).toEqual([flow().release]);
  });

  it("release.yml gives contents: write at job level only, never at the top (the checkout and the version script need no write)", () => {
    const writes = codeLines("release.yml").filter((l) => /contents:\s*write/.test(l));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.search(/\S/)).toBeGreaterThan(2);
  });

  it("release.yml runs the version script that exists and is executable", () => {
    const script = path.join(ROOT, ".github", "scripts", "next-version.sh");
    expect(codeLines("release.yml").join("\n")).toContain("./.github/scripts/next-version.sh");
    expect(fs.statSync(script).mode & 0o111).not.toBe(0);
  });

  it("release.yml fetches full history and tags: the version comes from commits since the last tag", () => {
    const text = codeLines("release.yml").join("\n");
    expect(text).toMatch(/fetch-depth:\s*0/);
    expect(text).toMatch(/fetch-tags:\s*true/);
  });

  it.each(files)("%s never uses pull_request_target: it would run with secrets on fork code", (f) => {
    expect(codeLines(f).filter((l) => /pull_request_target/.test(l))).toEqual([]);
  });

  it("production-guard.yml runs on pull requests into the release branch and fails a source that is not the other CI branch in this repo", () => {
    const text = codeLines("production-guard.yml").join("\n");
    const { integration, release } = flow();
    expect(text).toMatch(new RegExp(`pull_request:\\s*\\n\\s+branches:\\s*\\[${escaped(release)}\\]`));
    expect(text).toContain(`[ "$HEAD_REF" != "${integration}" ] || [ "$HEAD_REPO" != "$REPO" ]`);
  });

  it.each(["production-guard.yml", "release.yml", "ci.yml", "pr-body.yml"])("%s has no ${{ }} expression inside a run script: values go through env", (f) => {
    const lines = codeLines(f);
    let runIndent: number | undefined;
    const offenders: string[] = [];
    for (const line of lines) {
      const indent = line.length - line.trimStart().length;
      if (runIndent !== undefined && line.trim() !== "" && indent <= runIndent) runIndent = undefined;
      if (runIndent !== undefined && /\$\{\{/.test(line)) offenders.push(line.trim());
      const m = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
      if (m) {
        if (/\$\{\{/.test(m[2] ?? "")) offenders.push(line.trim());
        if (["|", ">", ">-", "|-"].includes(m[2] ?? "")) runIndent = indent;
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("which jobs run for which base: the full suite into the default branch and production, the lean job on a stacked PR", () => {
  const event = (name: string, base: string, defaultBranch = "staging", headRepo = "o/r"): Context => ({
    github: {
      event_name: name,
      base_ref: base,
      repository: "o/r",
      event: { repository: { default_branch: defaultBranch }, pull_request: { head: { repo: { full_name: headRepo } } } },
    },
    needs: { readiness: { outputs: { ready: "true" } } },
  });
  const ran = (f: string, context: Context) => jobsThatRun(jobsOf(read(f)), context);
  const pushed = ["baseline", "build", "e2e"];
  const full = {
    "ci.yml": [...pushed, "effect-diagnostics", "size", "lighthouse", "report"],
    "codeql.yml": ["analyze"],
    "preview.yml": ["readiness", "deploy-preview"],
    "pr-body.yml": ["size-table"],
  };
  const lean = { "ci.yml": ["lean"], "codeql.yml": [], "preview.yml": [], "pr-body.yml": ["size-table"] };
  const required = JSON.parse(fs.readFileSync(path.join(ROOT, ".github", "repo-rules.json"), "utf-8")).rulesets.flatMap(
    (set: { rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[] }) =>
      set.rules.flatMap((rule) => rule.parameters?.required_status_checks?.map((check) => check.context) ?? []),
  ) as string[];

  it.each([
    ["a PR into the default branch", event("pull_request", "staging"), full],
    ["a PR into production", event("pull_request", "production"), full],
    ["a PR into a fork's default branch with another name (nothing names staging)", event("pull_request", "trunk", "trunk"), full],
    ["a PR into a wave branch", event("pull_request", "v3/wave-1"), lean],
    ["a PR into the branch of the PR below it", event("pull_request", "v3/w1-157-lean-checks"), lean],
    ["a PR into a retired main", event("pull_request", "main"), lean],
  ])("%s runs exactly the expected jobs", (_, context, expected) => {
    for (const [f, jobs] of Object.entries(expected)) expect(ran(f, context), f).toEqual(jobs);
  });

  it("a PR from a fork into the default branch measures size and Lighthouse but skips the comment: its token cannot write", () => {
    expect(ran("ci.yml", event("pull_request", "staging", "staging", "someone/fork"))).toEqual([...pushed, "effect-diagnostics", "size", "lighthouse"]);
  });

  it("a push runs the full suite and not the lean job, the size job, Lighthouse or the comment (no PR to compare or comment on)", () => {
    expect(ran("ci.yml", event("push", ""))).toEqual(pushed);
    expect(ran("codeql.yml", event("push", ""))).toEqual(["analyze"]);
  });

  it("the weekly scan still runs: a schedule has no base branch", () => {
    expect(ran("codeql.yml", event("schedule", ""))).toEqual(["analyze"]);
  });

  it("the required check names are the job names on the full path, unchanged, and the lean job matches none of them", () => {
    const names = jobsOf(read("ci.yml")).map((job) => job.name);
    for (const check of required.filter((name) => !/^(PR title|Source branch)/.test(name))) expect(names).toContain(check);
    const leanJob = jobsOf(read("ci.yml")).find((job) => job.id === "lean");
    expect(leanJob?.name).toMatch(/^Lean /);
    expect(required).not.toContain(leanJob?.name);
    for (const check of required) expect(leanJob?.name.split(" ")[0]).not.toBe(check.split(" ")[0]);
  });

  it.each(["lean", "baseline"])("ci.yml %s checks out full history: the lint baseline compares with the base branch", (id) => {
    expect(jobsOf(read("ci.yml")).find((job) => job.id === id)?.body).toMatch(/fetch-depth:\s*0/);
  });

  it("the evaluator reads && before ||, as GitHub does, so the cases above test the real precedence", () => {
    expect(evaluate("'a' == 'b' && 'x' == 'x' || 'c' == 'c'", {})).toBe(true);
    expect(evaluate("'a' == 'b' && ('x' == 'x' || 'c' == 'c')", {})).toBe(false);
  });
});
