import { describe, it, expect } from "vitest";
import { pendingChecks, splitPending, withoutMarks } from "../repo-rules-pending";
import type { LiveRulesetT, Ruleset } from "../repo-rules-schemas";

const ruleset = (entries: unknown[]): Ruleset => ({
  name: "r",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: [], exclude: [] } },
  rules: [{ type: "deletion" }, { type: "required_status_checks", parameters: { strict: false, required_status_checks: entries } }],
});

const live = (contexts: string[]): LiveRulesetT => ({
  target: "branch",
  enforcement: "active",
  rules: [{ type: "required_status_checks", parameters: { required_status_checks: contexts.map((context) => ({ context })) } }],
});

const checksOf = (rs: Ruleset) => rs.rules.find((r) => r.type === "required_status_checks")?.parameters?.required_status_checks;

describe("pendingChecks", () => {
  it("lists only entries with a reason, so an unmarked check is compared exactly", () => {
    expect(pendingChecks(ruleset([{ context: "A" }, { context: "B", pending: "later" }]))).toEqual([{ context: "B", reason: "later" }]);
  });
});

describe("withoutMarks", () => {
  it("removes the pending key and keeps every other key, so it never reaches GitHub", () => {
    const out = withoutMarks(ruleset([{ context: "A", integration_id: 1, pending: "later" }, { context: "B" }]));
    expect(checksOf(out)).toEqual([{ context: "A", integration_id: 1 }, { context: "B" }]);
    expect(out.rules[1]?.parameters?.strict).toBe(false);
  });
});

describe("splitPending", () => {
  const decl = ruleset([{ context: "A" }, { context: "B", pending: "later" }]);

  it("drops a pending check the live ruleset lacks from the compared rules", () => {
    const s = splitPending(decl, live(["A"]));
    expect(checksOf(s.effective)).toEqual([{ context: "A" }]);
    expect(s.absent).toEqual([{ context: "B", reason: "later" }]);
    expect(s.present).toEqual([]);
  });

  it("keeps a pending check the live ruleset has, so a difference in it still shows", () => {
    const s = splitPending(decl, live(["A", "B"]));
    expect(checksOf(s.effective)).toEqual([{ context: "A" }, { context: "B" }]);
    expect(s.present).toEqual([{ context: "B", reason: "later" }]);
  });
});
