import { describe, expect, it } from "vitest";
import { dryRun, type AgentCall } from "../../lib/workflow-dry-run";
import { ARGS, PR1, PR2, SLUG, happy } from "./ship-feature.fixtures";

const prompt = (calls: AgentCall[], label: string): string => calls.find((c) => c.label === label)?.prompt ?? "";

describe("ship-feature: the size section in PR bodies (#159)", () => {
  it("every PR body and the roll-up body get the size section, measured against the PR's own base before the PR is created (CI fails a PR that changes shipped code with no table)", async () => {
    const stopped = await dryRun("ship-feature", { args: ARGS, answers: happy() });
    const shipped = await dryRun("ship-feature", { args: { ...ARGS, ships: { "1": { approved: true } } }, answers: happy(), resumeFrom: stopped });
    const open = prompt(shipped.calls, "open:prs");
    expect(open).toContain("bun run size --base <base> --pr-body");
    expect(open).toContain(`branch=${PR1.branch} base='origin/review/${SLUG}'`);
    expect(open).toContain(`branch=${PR2.branch} base='origin/${PR1.branch}'`);
    expect(open.indexOf("--pr-body")).toBeLessThan(open.indexOf("gh pr create"));
    expect(open).toContain(`Then \`git switch ${PR2.branch}\``);
    const rollup = prompt(shipped.calls, "rollup:pr");
    expect(rollup).toContain("bun run size --base 'origin/staging' --pr-body");
    expect(rollup.indexOf("--pr-body")).toBeLessThan(rollup.indexOf("gh pr create"));
  });
});
