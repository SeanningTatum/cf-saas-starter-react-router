import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Runs the real .claude/workflows/plan-feature.js body with a fake `agent`, answered by label, so the
// plan loop is tested without a model. The fake assembler writes the record from what its prompt
// asks it to honour, and the fake publish snapshots that record: a note that never reaches the
// assembler never reaches the published record.

type Opts = { label: string };
type Call = { label: string; prompt: string };
type Result = Record<string, unknown>;

const SCRIPT = readFileSync(join(__dirname, "../../.claude/workflows/plan-feature.js"), "utf8").replace(/^export const meta/m, "const meta");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...params: string[]) => (...a: unknown[]) => Promise<Result>;
const workflow = new AsyncFunction("args", "agent", "log", "phase", "parallel", SCRIPT);

const ISSUE = "https://github.com/owner/repo/issues/47";
const NOTE = "can we also make the kitchen sink dev only";

const producer: Record<string, unknown> = {
  context: { summary: "s", related_features: [], decisions: [], code_paths: [], prior_work: [], unknowns: [] },
  audit: { slug: "agent-sandbox-seeding", verdict: "ready", reason: "r", items: [], amended: { title: "T", body: "B" }, questions: [] },
  fit: {
    user: "u",
    job: "j",
    fit: { verdict: "fits", why: "w" },
    metric: { measure: "m", baseline: "b", target: "t", how: "h" },
    non_goals: [{ item: "Replacing or changing /admin/kitchen-sink", why: "out of scope" }],
    scope_tiers: { thin: "t", complete: "c", gold: "g" },
    prior_art: [],
    decisions: [],
  },
  architect: { tables: [], repositories: [], procedures: [], errors: [], spans: [], seed_fixtures: [], ai: false, prompt_contracts: [], eval_plan: "", contract: "", fences: [], decisions: [] },
  stack: { flow_mermaid: "flowchart LR", prs: [{ n: 1, branch: "feat/x/1", base: "main", title: "x", fence: ["app/"], size: "S", greptile_focus: "f" }] },
};

function run(plans: Record<string, unknown>) {
  const calls: Call[] = [];
  const logs: string[] = [];
  let record = "";
  let published: string | null = null;
  const reply = (label: string, prompt: string): unknown => {
    if (label === "preflight")
      return {
        ok: true,
        reason: "",
        root: "/repo",
        date: "2026-11-22",
        backend: "gh",
        has_product: true,
        has_design: true,
        has_to_spec: true,
        issue: { ref: "#47", number: 47, url: ISSUE, title: "T", body: "B", state: "OPEN", labels: [], updatedAt: "2026-11-01T00:00:00Z", comments: [] },
      };
    if (label.startsWith("judge:")) return { verdict: "pass", items: [{ id: "c1", pass: true, evidence: "ok" }], fixes: [] };
    if (label.startsWith("memory:")) return "recorded";
    if (label === "writeback:body") return { title: "T", body_file: "/repo/.verify/x/issue-body.md", comment_file: "/repo/.verify/x/change-comment.md" };
    if (label === "writeback") return { ok: true, failed_command: "", issue_url: ISSUE, issue_ref: "#47", stale_skipped: false, overwrote_concurrent_edit: false, conflict: "" };
    if (label === "check:assemble") {
      const asked = prompt.split("honour these requests:\n")[1];
      const honoured = asked ? asked.split("\n").filter((l) => l.startsWith("- [")) : [];
      record = ["# Decision record", "## Non-goals", "- Replacing or changing /admin/kitchen-sink", ...honoured].join("\n");
      return { ok: true, failures: [], file: "/repo/.verify/x/record.md" };
    }
    if (label === "check:flush-accepted") return { ok: true, failures: [], file: "/repo/.verify/x/record.md" };
    if (label === "publish:polish") return { reverted: false, note: "" };
    if (label === "publish") {
      published = record;
      return { ok: true, failed_command: "", record_comment_url: `${ISSUE}#issuecomment-1`, note: "" };
    }
    const key = label.replace(/:revise$/, "");
    if (key in producer) return producer[key];
    throw new Error(`no fake for agent label ${label}`);
  };
  const agent = async (prompt: string, opts: Opts) => {
    calls.push({ label: opts.label, prompt });
    return reply(opts.label, prompt);
  };
  const parallel = (fns: (() => Promise<unknown>)[]) => Promise.all(fns.map((f) => f()));
  const args = { ticket: ISSUE, brief: { decision: "approve", answers: {}, hasUi: false, research: false }, plans };
  return workflow(args, agent, (m: string) => logs.push(m), () => {}, parallel).then((result) => ({ result, calls, logs, published: published as string | null }));
}

const labels = (calls: Call[]) => calls.map((c) => c.label);

describe("plan-feature plan loop", () => {
  it("an approval that carries an 'other' note publishes a record that holds the note (issue #47 dropped it)", async () => {
    const { result, calls, published } = await run({ "1": { approved: true, pick: "", changes: [{ target: "other", text: NOTE }] } });

    expect(result.record_comment_url).toBe(`${ISSUE}#issuecomment-1`);
    expect(published).toContain(NOTE);
    const l = labels(calls);
    // Rebuilt with the note, then judged as a whole record, then published; no second review round.
    const rebuild = calls.findIndex((c) => c.label === "check:assemble" && c.prompt.includes(NOTE));
    expect(calls[rebuild].prompt).toContain("approved the plan with these notes");
    expect(l.indexOf("judge:record:plan-round-1")).toBeGreaterThan(rebuild);
    expect(l.indexOf("publish")).toBeGreaterThan(l.indexOf("judge:record:plan-round-1"));
    expect(l).not.toContain("memory:record:needs-plan:2");
    // 'other' re-runs no producer, as for a change request.
    expect(l.filter((x) => x.endsWith(":revise"))).toEqual([]);
  });

  it("an approval with a fit note re-runs fit and everything downstream through the gate before publishing", async () => {
    const { result, calls, published } = await run({ "1": { approved: true, changes: [{ target: "fit", text: NOTE }] } });

    expect(result.record_comment_url).toBeTruthy();
    expect(published).toContain(NOTE);
    const l = labels(calls);
    for (const k of ["fit", "architect", "stack"]) {
      expect(l).toContain(`${k}:revise`);
      expect(l).toContain(`judge:${k}:plan-round-1`);
    }
    expect(calls.find((c) => c.label === "fit:revise")?.prompt).toContain(`The human says: ${NOTE}`);
  });

  it("an approval with no notes publishes the first assembly unchanged, as before", async () => {
    const { result, calls } = await run({ "1": { approved: true, changes: [] } });

    expect(result.record_comment_url).toBeTruthy();
    const l = labels(calls);
    expect(l.filter((x) => x === "check:assemble")).toHaveLength(1);
    expect(l.some((x) => x.startsWith("judge:record:plan-round"))).toBe(false);
    expect(l.some((x) => x.endsWith(":revise"))).toBe(false);
  });

  it("a change request without approval still stops for another review round", async () => {
    const { result, calls } = await run({ "1": { approved: false, changes: [{ target: "other", text: NOTE }] } });

    expect(result.status).toBe("needs-plan");
    expect(result.round).toBe(2);
    expect(labels(calls)).not.toContain("publish");
  });
});
