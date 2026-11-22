import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintTitle } from "./helpers/lint-title";

const ROOT = path.join(__dirname, "..", "..");
const AGENTS_DIR = path.join(ROOT, ".claude", "agents");
const SCOPE_PLACEHOLDER = "<scope>";
const SAMPLE_SCOPE = "ui";
const HEADER_LIMIT = 100;
const GIT_ENV_PREFIX = "GIT_";
const SPAWN_TIMEOUT_MS = 30_000;
const LONG_LINE = "x".repeat(400);

const padTo = (prefix: string, length: number) => prefix + "a".repeat(length - prefix.length);

const accepted: [string, string][] = [
  ["a scoped feature", "feat(auth): add passkeys"],
  ["an unscoped fix", "fix: handle empty list"],
  ["a breaking release title with a version and a comma", "feat!: v3.0, the new starter"],
  ["a wave roll-up title with a version", "feat: v3.0 wave 1, delivery and gates"],
  ["a dependency bump", "chore(deps): bump wrangler"],
  ["a GitHub merge commit", "Merge pull request #12 from o/b"],
  ["a branch merge commit", "Merge branch 'staging' into x"],
  ["a header of exactly 100 characters", padTo("feat: ", HEADER_LIMIT)],
];

const refused: [string, string][] = [
  ["the v3.0 roll-up title read as a patch", "v3.0 wave 0: guardrails, trim and foundations"],
  ["a title with no type", "Update README"],
  ["a scope outside the list", "feat(nonsense-scope): x"],
  ["a type outside the list", "feature: x"],
  ["an empty title", ""],
  ["a header of 101 characters", padTo("feat: ", HEADER_LIMIT + 1)],
];

describe("the repo's commitlint config on titles", () => {
  it.each(accepted)("accepts %s", async (_name, title) => {
    const verdict = await lintTitle(title);
    expect(verdict.problems).toEqual([]);
    expect(verdict.valid).toBe(true);
  });

  it.each(refused)("refuses %s", async (_name, title) => {
    expect((await lintTitle(title)).valid).toBe(false);
  });

  it("accepts a long body line and a long URL in the body: PR bodies and agent commit bodies hold both", async () => {
    const message = `fix(ui): wrap the table\n\n${LONG_LINE}\n\nSee https://example.invalid/${LONG_LINE}\n\nCloses #1`;
    expect((await lintTitle(message)).valid).toBe(true);
  });
});

describe("subjects the agent briefs dictate", () => {
  const briefs = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
  const literals = briefs.flatMap((f) => {
    const text = fs.readFileSync(path.join(AGENTS_DIR, f), "utf-8");
    return [...text.matchAll(/git commit -m "([^"]+)"/g)].map((m) => [f, (m[1] ?? "").replace(SCOPE_PLACEHOLDER, SAMPLE_SCOPE)] as const);
  });

  it("finds at least the review-responder commit, so this scan cannot pass by finding nothing", () => {
    expect(literals.map(([f]) => f)).toContain("review-responder.md");
  });

  it.each(literals)("%s: the literal commit subject '%s' follows Conventional Commits", async (_file, subject) => {
    expect((await lintTitle(subject)).problems).toEqual([]);
  });

  it("tells review-responder to take its scope from .commitlintrc.json: a free scope like the PR's slug fails the commit-msg hook", () => {
    const text = fs.readFileSync(path.join(AGENTS_DIR, "review-responder.md"), "utf-8");
    expect(text).toMatch(/scope from `\.commitlintrc\.json`/);
  });

  it("tells the architect to write stacked PR titles as Conventional Commits subjects: the title becomes the squash commit subject", () => {
    const text = fs.readFileSync(path.join(AGENTS_DIR, "architect.md"), "utf-8");
    expect(text).toMatch(/`title`: a Conventional Commits subject per `\.commitlintrc\.json`/);
  });
});

const envWithoutGit = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith(GIT_ENV_PREFIX)));

const runWorkflowCommand = (title: string) =>
  spawnSync("bunx", ["--no-install", "commitlint"], {
    cwd: ROOT,
    input: `${title}\n`,
    encoding: "utf-8",
    env: envWithoutGit(),
  });

describe("the command line the PR title job runs", () => {
  it("exits 0 for a good title, so a conforming PR is not blocked", () => {
    expect(runWorkflowCommand("feat(auth): add passkeys").status).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it("exits non-zero for an empty title, so a PR with a blank title is stopped", () => {
    expect(runWorkflowCommand("").status).not.toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it("exits non-zero for a bad title, so the roll-up title that reads as a patch is stopped", () => {
    expect(runWorkflowCommand("v3.0 wave 0: guardrails, trim and foundations").status).not.toBe(0);
  }, SPAWN_TIMEOUT_MS);
});
