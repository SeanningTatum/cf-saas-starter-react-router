import { describe, it, expect } from "vitest";
import { CONFIG_PATH, PENDING_APPLIED_NOTICE } from "../lib/repo-rules-constants";
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

const live = (contexts: string[]): LiveRulesetT => ({
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["x"], exclude: [] } },
  rules: [{ type: "required_status_checks", parameters: { required_status_checks: contexts.map((context) => ({ context })) } }],
});

describe("constants", () => {
  it("the apply notice names the file the owner edits", () => {
    expect(PENDING_APPLIED_NOTICE).toContain(CONFIG_PATH);
  });
});

describe("planRuleset", () => {
  it("a missing ruleset is a POST whose body has no pending mark, flagged as writing a pending item", () => {
    const plan = planRuleset(decl, null, "repos/a/b");
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.pending).toBe(true);
    expect(JSON.stringify(plan.actions[0]?.body)).not.toContain("pending");
  });

  it("a ruleset that lacks only the pending check is ok, plans a PUT with the check, and is flagged pending", () => {
    const plan = planRuleset(decl, { id: 3, live: live(["A"]) }, "repos/a/b");
    expect(plan.findings.map((f) => f.level)).toEqual(["ok", "notice"]);
    expect(plan.actions[0]).toMatchObject({ method: "PUT", path: "repos/a/b/rulesets/3", pending: true });
    expect(JSON.stringify(plan.actions[0]?.body)).toContain('"B"');
  });

  it("a matching ruleset plans no write", () => {
    expect(planRuleset(decl, { id: 3, live: live(["A", "B"]) }, "repos/a/b").actions).toEqual([]);
  });
});

describe("planRepository", () => {
  const repo = { squash_merge_commit_title: "PR_TITLE" } as const;

  it("a different title without pending is drift that stays soft on a fresh fork", () => {
    const plan = planRepository(repo, "COMMIT_OR_PR_TITLE", "a/b");
    expect(plan.findings).toEqual([
      { level: "drift", text: 'repository squash_merge_commit_title: declared "PR_TITLE", live "COMMIT_OR_PR_TITLE"', softWhenFresh: true },
    ]);
    expect(plan.actions[0]).toMatchObject({ method: "PATCH", path: "repos/a/b", pending: false });
  });

  it("the PATCH of a pending title is flagged pending and carries one key", () => {
    const plan = planRepository({ ...repo, pending: "later" }, undefined, "a/b");
    expect(plan.actions[0]?.body).toEqual({ squash_merge_commit_title: "PR_TITLE" });
    expect(plan.actions[0]?.pending).toBe(true);
  });
});
