import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { jobsOf, jobsThatRun, type Context } from "./helpers/workflow-jobs";

const ROOT = path.join(__dirname, "..", "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, ".github", "workflows", f), "utf-8");
const codeLines = (f: string) =>
  read(f)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line));
const staging = codeLines("deploy-staging.yml");
const text = staging.join("\n");
const at = (needle: string) => {
  const index = text.indexOf(needle);
  expect(index, `deploy-staging.yml lacks ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
};

const ciPushBranches = (): string[] => {
  const lines = codeLines("ci.yml");
  const push = lines.findIndex((line) => /^ {2}push:\s*$/.test(line));
  return (lines[push + 1]?.match(/branches:\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").map((b) => b.trim());
};

const run = (conclusion: string, event: string, ready: string): string[] =>
  jobsThatRun(jobsOf(read("deploy-staging.yml")), {
    github: { event: { workflow_run: { conclusion, event } } },
    needs: { readiness: { outputs: { ready } } },
  } satisfies Context);

describe("deploy-staging.yml: which jobs run", () => {
  it("follows CI on the branch pull requests land on, the first push branch of ci.yml, so that every merge reaches staging and a fork that renames it keeps working", () => {
    const match = text.match(/workflow_run:\s*\n\s+workflows:\s*\[CI\]\s*\n\s+types:\s*\[completed\]\s*\n\s+branches:\s*\[([^\]]*)\]/);
    expect(match?.[1]?.trim()).toBe(ciPushBranches()[0]);
  });

  it.each([
    ["CI passed on a push, set up", "success", "push", "true", ["readiness", "deploy"]],
    ["CI passed on a push, not set up", "success", "push", "false", ["readiness"]],
    ["CI failed on a push", "failure", "push", "true", []],
    ["CI passed on a pull request", "success", "pull_request", "true", []],
  ])("%s runs exactly the expected jobs, so that only tested pushes deploy and a fresh fork skips", (_, conclusion, event, ready, expected) => {
    expect(run(conclusion, event, ready)).toEqual(expected);
  });

  it("never cancels a running deploy, so that a second merge cannot stop a migration halfway", () => {
    expect(text).toMatch(/concurrency:\s*\n\s+group: deploy-staging\s*\n\s+cancel-in-progress: false/);
  });
});

describe("deploy-staging.yml: the deploy job", () => {
  it("migrates, builds for staging, deploys, smoke-checks, then runs the @deployed specs, in that order, so that no check runs against the old version", () => {
    const order = [
      "bunx wrangler d1 migrations apply DATABASE --env staging --remote",
      "CLOUDFLARE_ENV: staging",
      "bunx wrangler deploy",
      "bun scripts/ci/smoke-check.ts",
      "bunx playwright test --grep @deployed",
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("names the release by the tested commit and checks that release answers, so that a smoke check passing on the old version cannot hide a failed deploy", () => {
    expect(text).toContain('bunx wrangler deploy --var "RELEASE_VERSION:$DEPLOY_SHA" --var ENVIRONMENT:staging');
    expect(text).toContain('bun scripts/ci/smoke-check.ts --url "$STAGING_URL" --release "$DEPLOY_SHA"');
    expect(text).toMatch(/DEPLOY_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/);
    expect(text).toMatch(/E2E_EXPECT_RELEASE:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/);
  });

  it("checks out the commit CI tested, in both jobs, so that staging ships what passed", () => {
    expect(text.match(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/g)).toHaveLength(2);
  });

  it("runs in the staging environment and hands the token to steps only, never to a job or the readiness check, so that a token set on the environment stays out of pull-request code", () => {
    expect(text).toMatch(/^ {4}environment: staging$/m);
    const tokenLines = staging.filter((line) => /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\./.test(line));
    expect(tokenLines.length).toBeGreaterThan(0);
    for (const line of tokenLines) expect(line.length - line.trimStart().length).toBeGreaterThanOrEqual(10);
    const readiness = jobsOf(read("deploy-staging.yml")).find((job) => job.id === "readiness");
    expect(readiness?.body).not.toContain("secrets.");
  });

  it("skips with a notice when no token is set, so that a repo without one stays green", () => {
    expect(text).toContain("::notice::Deploy Staging skipped");
    const deployJob = text.slice(at("\n  deploy:"));
    for (const step of [
      "Install dependencies",
      "Apply staging D1",
      "Build (staging env)",
      "Deploy to Cloudflare Workers (staging)",
      "Smoke check",
      "Run the @deployed",
    ]) {
      const block = deployJob.slice(deployJob.indexOf(`- name: ${step}`));
      expect(block.split("\n").slice(0, 3).join("\n"), step).toContain("steps.token.outputs.ready == 'true'");
    }
  });
});
