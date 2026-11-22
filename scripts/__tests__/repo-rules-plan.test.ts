import { describe, it, expect } from "vitest";
import { planRepository, planRuleset } from "../lib/repo-rules-plan";
import type { LiveRulesetT, Ruleset } from "../lib/repo-rules-schemas";

const decl: Ruleset = {
  name: "main",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["x"], exclude: [] } },
  rules: [
    {
      type: "required_status_checks",
      parameters: { required_status_checks: [{ context: "A" }, { context: "B", pending: "later" }] },
    },
  ],
};

const live: LiveRulesetT = {
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["x"], exclude: [] } },
  rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "A" }, { context: "B" }] } }],
};

describe("planRuleset", () => {
  it("a missing ruleset is a POST flagged as writing a pending item, so the apply notice fires", () => {
    expect(planRuleset(decl, null, "repos/a/b").actions[0]).toMatchObject({ method: "POST", pending: true });
  });

  it("a ruleset that already has the pending check plans no write, so a second apply is silent", () => {
    expect(planRuleset(decl, { id: 3, live }, "repos/a/b").actions).toEqual([]);
  });
});

describe("planRepository", () => {
  it("an unmarked title that differs is drift marked soft, so a fresh fork stays green", () => {
    const plan = planRepository({ squash_merge_commit_title: "PR_TITLE" }, "COMMIT_OR_PR_TITLE", "a/b");
    expect(plan.findings[0]).toMatchObject({ level: "drift", softWhenFresh: true });
  });
});
