import { describe, it, expect } from "vitest";
import { planRepository, planRuleset, withEnvPending, type Plan } from "../repo-rules-plan";
import type { LiveRulesetT, Ruleset } from "../repo-rules-schemas";

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

describe("withEnvPending", () => {
  const put = { method: "PUT" as const, path: "repos/a/b/environments/staging", body: {} };
  const bare: Plan = { findings: [{ level: "missing", text: 'environment "staging"', adminOnly: true }], actions: [put], applied: false };
  const ok: Plan = { findings: [{ level: "ok", text: 'environment "staging" matches .github/repo-rules.json' }], actions: [], applied: true };
  const drift: Plan = { findings: [{ level: "drift", text: 'environment "staging" reviewers: declared [], live ["x"]' }], actions: [put], applied: true };

  it("turns a missing pending environment into a notice with its reason and marks its writes pending, so that a declared staging environment does not turn the gate red before the owner applies it", () => {
    const plan = withEnvPending(bare, "staging", "the owner applies it later");
    expect(plan.findings).toEqual([{ level: "notice", text: expect.stringContaining("pending: the owner applies it later") }]);
    expect(plan.actions.every((a) => a.pending)).toBe(true);
  });

  it("adds a notice that the mark can go once the environment matches, so that the mark does not outlive the apply", () => {
    expect(withEnvPending(ok, "staging", "later").findings[1]?.text).toContain('delete its "pending" mark');
  });

  it("leaves drift in a live environment as drift, and an unmarked environment untouched, so that the mark never hides a weakened rule", () => {
    expect(withEnvPending(drift, "staging", "later")).toEqual(drift);
    expect(withEnvPending(bare, "staging", undefined)).toEqual(bare);
  });
});
