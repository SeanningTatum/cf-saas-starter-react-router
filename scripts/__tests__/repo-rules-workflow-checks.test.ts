import { describe, it, expect } from "vitest";
import { jobNames, requiredContexts } from "../lib/repo-rules-workflow-checks";
import type { Ruleset } from "../lib/repo-rules-schemas";

const withChecks = (contexts: string[]): Ruleset => ({
  name: "r",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: [], exclude: [] } },
  rules: [{ type: "required_status_checks", parameters: { required_status_checks: contexts.map((context) => ({ context })) } }],
});

describe("jobNames", () => {
  it("reads job names only, never step names", () => {
    const yml = ["name: X", "jobs:", "  a:", '    name: "Guard"', "    steps:", "      - name: Step"].join("\n");
    expect(jobNames(yml)).toEqual(["Guard"]);
  });
});

describe("requiredContexts", () => {
  it("lists a check once when two rulesets require it, so one missing job gives one error", () => {
    expect(requiredContexts([withChecks(["Guard", "Build"]), withChecks(["Build"])])).toEqual(["Build", "Guard"]);
  });
});
