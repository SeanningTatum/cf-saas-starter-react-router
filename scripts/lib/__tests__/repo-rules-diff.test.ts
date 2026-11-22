import { describe, it, expect } from "vitest";
import {
  differ,
  rulesetDiffs,
  stable,
} from "../repo-rules-diff";
import type { LiveRulesetT, Ruleset } from "../repo-rules-schemas";

const declared: Ruleset = {
  name: "production",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["refs/heads/production"], exclude: [] } },
  rules: [
    { type: "pull_request", parameters: { allowed_merge_methods: ["merge"] } },
    {
      type: "required_status_checks",
      parameters: { required_status_checks: [{ context: "Guard", integration_id: 7 }, { context: "Build" }] },
    },
  ],
};

const liveChecks = [
  { context: "Guard", integration_id: 7 },
  { context: "Build", integration_id: 99 },
];

const live = (patch: Partial<LiveRulesetT> = {}): LiveRulesetT => ({
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["refs/heads/production"], exclude: [] } },
  rules: [
    { type: "pull_request", parameters: { allowed_merge_methods: ["merge"], required_reviewers: [] } },
    { type: "required_status_checks", parameters: { required_status_checks: liveChecks } },
  ],
  ...patch,
});

describe("stable", () => {
  it("two objects with the same keys in another order compare equal, so key order never reads as drift", () => {
    expect(stable({ a: 1, b: [1, { d: 1, c: 2 }] })).toBe(stable({ b: [1, { c: 2, d: 1 }], a: 1 }));
  });
});

describe("differ", () => {
  it("reports one line per differing field and none for equal ones", () => {
    const d = differ("x");
    d.cmp("same", [1], [1]);
    d.cmp("other", 1, undefined);
    expect(d.lines).toEqual(["x other: declared 1, live absent"]);
  });
});

describe("rulesetDiffs required checks", () => {
  it("a pinned check on another app than the file names is drift, so a swapped app shows", () => {
    const swapped = live({
      rules: [
        { type: "pull_request", parameters: { allowed_merge_methods: ["merge"], required_reviewers: [] } },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              { context: "Guard", integration_id: 8 },
              { context: "Build", integration_id: 99 },
            ],
          },
        },
      ],
    });
    expect(rulesetDiffs(declared, swapped).join("\n")).toContain("Guard (app 8)");
  });
});

describe("rulesetDiffs", () => {
  it("extra live fields and an unpinned integration_id give no drift", () => {
    expect(rulesetDiffs(declared, live())).toEqual([]);
  });

  it("a live rule the file does not declare is drift, so a hand-added rule shows", () => {
    const extra = live({ rules: [...live().rules, { type: "required_linear_history" }] });
    expect(rulesetDiffs(declared, extra)).toEqual(['ruleset "production" rules.required_linear_history: declared absent, live present']);
  });

  it("a hidden bypass list is not compared, so a caller without admin rights sees no false drift", () => {
    expect(rulesetDiffs(declared, live({ bypass_actors: undefined }))).toEqual([]);
  });
});
