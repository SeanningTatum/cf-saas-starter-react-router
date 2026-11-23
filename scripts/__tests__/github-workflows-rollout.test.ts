import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { jobsOf, jobsThatRun, type Context } from "./helpers/workflow-jobs";

const read = (f: string) => fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", f), "utf-8");
const deployYml = read("deploy.yml");
const jobs = jobsOf(deployYml);
const job = (id: string) => {
  const found = jobs.find((entry) => entry.id === id);
  expect(found, `deploy.yml has no ${id} job`).toBeDefined();
  return found?.body ?? "";
};

const run = (deployResult: string, failure: boolean): string[] =>
  jobsThatRun(
    jobs.map((entry) => (entry.id === "readiness" ? { ...entry, condition: undefined } : entry)),
    {
      failure,
      needs: { readiness: { outputs: { ready: "true" } }, deploy: { result: deployResult } },
    } satisfies Context,
  );

describe("deploy.yml: gradual rollout", () => {
  it("rolls out through the tested script after the migration and the build, with the token, the release and the production URL, so that traffic moves only once the schema and the bundle are ready", () => {
    const deploy = job("deploy");
    const order = ["bun run db:migrate:remote", "bun run build", "bun scripts/ci/rollout.ts"].map((needle) => deploy.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const step = deploy.slice(deploy.indexOf("- name: Roll out to Cloudflare Workers in steps"));
    expect(step).toMatch(/CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
    expect(step).toMatch(/PRODUCTION_URL:\s*\$\{\{\s*vars\.PRODUCTION_URL\s*\}\}/);
    expect(step).toMatch(/id: rollout/);
  });

  it("still waits for the production environment's reviewer before any of it, so that a person approves each production deploy", () => {
    expect(job("deploy")).toMatch(/^ {4}environment: production$/m);
  });

  it("passes the rollout's outcome, step and versions up as job outputs, so that the announcement can say what happened", () => {
    for (const key of ["outcome", "failed_at", "version_id", "previous_version_id"]) {
      expect(job("deploy")).toContain(`${key}: \${{ steps.rollout.outputs.${key} }}`);
    }
  });
});

describe("deploy.yml: announcing a failure on GitHub", () => {
  it.each([
    ["the deploy failed", "failure", true, ["readiness", "deploy", "announce-failure"]],
    ["the deploy passed", "success", false, ["readiness", "deploy"]],
    ["the deploy was skipped", "skipped", false, ["readiness", "deploy"]],
  ])("when %s, runs exactly the expected jobs, so that only a real failure opens or comments on the issue", (_, result, failure, expected) => {
    expect(run(result, failure)).toEqual(expected);
  });

  it("gives issues: write to the announce job only, and that job checks out nothing, so that no repo code runs with a write token", () => {
    const announce = job("announce-failure");
    expect(announce).toMatch(/permissions:\s*\n\s+issues: write/);
    expect(announce).not.toContain("actions/checkout");
    expect(announce).not.toContain("secrets.");
    expect(deployYml.match(/issues: write/g)).toHaveLength(1);
  });

  it("comments on the one open failed-deploy issue or opens it, with the run link and the rollback command, so that repeated failures do not flood the tracker", () => {
    const announce = job("announce-failure");
    expect(announce).toContain('title="Production deploy failed"');
    expect(announce).toContain("gh issue comment");
    expect(announce).toContain("gh issue create");
    expect(announce).toContain("RUN_URL:");
    expect(announce).toContain("bunx wrangler versions deploy $PREVIOUS_VERSION_ID@100% -y");
  });

  it("names a place for a webhook without adding one, so that chat or email can be added later as one step", () => {
    expect(deployYml).toMatch(/# A chat or email webhook would be one more step here/);
    expect(deployYml).not.toMatch(/SLACK|DISCORD|WEBHOOK_URL/i);
  });
});
