import { describe, expect, it } from "vitest";
import { stableJson } from "../harness-config";
import { ledgerChecksum } from "../run-telemetry";
import { withTicket } from "../wave-state";
import { mergeRollupBody, outLine, ownerSteps, rollupBody, statusLines } from "../wave-report";
import { ticket, waveOf } from "./helpers/wave-fixture";

const finished = () => {
  let s = waveOf([ticket(1, { title: "Add billing" }), ticket(2, { title: "Wide rename", wide: true }), ticket(3, { title: "Docs" })]);
  s = withTicket(s, 1, () => ({ status: "merged", pr: 101, ownerSteps: ["set STRIPE_KEY in the dashboard", "rotate the webhook secret"] }));
  s = withTicket(s, 2, () => ({ status: "skipped", why: "skipped by a person" }));
  return withTicket(s, 3, () => ({ status: "merged", pr: 103, ownerSteps: ["run the backfill"] }));
};

describe("outLine", () => {
  it("is one JSON line whose check is over the stable JSON, so key order cannot break it and an edit shows", () => {
    const line = outLine({ step: { kind: "merge", batch: 0 } });
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed.out).toEqual({ step: { kind: "merge", batch: 0 } });
    expect(parsed.check).toBe(ledgerChecksum(stableJson({ step: { batch: 0, kind: "merge" } })));
    expect(JSON.parse(outLine({ b: 1, a: 2 })).check).toBe(JSON.parse(outLine({ a: 2, b: 1 })).check);
    expect(JSON.parse(outLine({ a: 2 })).check).not.toBe(JSON.parse(outLine({ a: 3 })).check);
  });
});

describe("ownerSteps", () => {
  it("lists every human step with its ticket, in ticket order", () => {
    expect(ownerSteps(finished())).toEqual([
      { n: 1, step: "set STRIPE_KEY in the dashboard" },
      { n: 1, step: "rotate the webhook secret" },
      { n: 3, step: "run the backfill" },
    ]);
  });
});

describe("statusLines", () => {
  it("tells a person how to resume a paused wave and names the tickets of a halt", () => {
    const s = { ...waveOf([ticket(1), ticket(2)]), paused: true, halt: { signature: "bun install failed", tickets: [1, 2] } };
    const lines = statusLines(s);
    expect(lines).toContain("PAUSED: run `bun scripts/wave.ts resume wave-two`, then start the workflow again");
    expect(lines).toContain("HALTED on a shared failure in #1, #2: bun install failed");
  });

  it("shows each ticket's status, PR, wide flag and reason, the plan's batches, the notes and the roll-up as never merged", () => {
    const s = { ...finished(), rollupPr: 900, notes: ["#1 is blocked by #99, which is not in this wave: treated as done"] };
    const lines = statusLines(s);
    expect(lines).toContain("  #1 merged PR #101 [build] Add billing");
    expect(lines).toContain("  #2 skipped no PR [build, wide] Wide rename (skipped by a person)");
    expect(lines).toContain("planned batches: 1: #1, #3 | 2: #2");
    expect(lines).toContain("note: #1 is blocked by #99, which is not in this wave: treated as done");
    expect(lines).toContain("  #3: run the backfill");
    expect(lines).toContain("roll-up: PR #900 (never merged by the run)");
  });

  it("says the plan waits for approval before it is approved, and shows the running batch", () => {
    const s = { ...waveOf([ticket(1)]), planApproved: false };
    expect(statusLines(s)[1]).toMatch(/^plan waiting for approval;/);
    const running = {
      ...waveOf([ticket(1)]),
      batch: { index: 0, tickets: [1], gate: "" as const, gateFailures: 0, gateLog: "", closed: false },
    };
    expect(statusLines(running)[2]).toBe("batches done: 0; batch 1 running (#1), gate not run");
  });
});

describe("rollupBody", () => {
  it("lists merged and skipped tickets and every human step, and says the run never merges the roll-up", () => {
    const body = rollupBody(finished());
    expect(body).toContain("The wave workflow opened this PR and never merges it.");
    expect(body).toContain("## Merged\n- #1 Add billing (PR #101)\n- #3 Docs (PR #103)");
    expect(body).toContain("## Skipped\n- #2 Wide rename: skipped by a person");
    expect(body).toContain("## Human steps\n- #1: set STRIPE_KEY in the dashboard\n- #1: rotate the webhook secret\n- #3: run the backfill");
  });

  it("says no human steps were reported rather than leaving the section empty, and drops an empty skipped section", () => {
    const s = withTicket(waveOf([ticket(1, { title: "Docs" })]), 1, () => ({ status: "merged", pr: 101 }));
    const body = rollupBody(s);
    expect(body).toContain("## Human steps\n- None reported.");
    expect(body).not.toContain("## Skipped");
  });
});

describe("rollupBody and mergeRollupBody", () => {
  it("says the roll-up holds the whole wave branch, so a reader does not take the ticket list for all of it", () => {
    expect(rollupBody(finished())).toContain("not only the tickets of one run");
  });

  it("puts the size section in the body when one is given", () => {
    expect(rollupBody(finished(), "## Size\n\ntable\n")).toMatch(/\n\n## Size\n\ntable$/);
    expect(rollupBody(finished())).not.toContain("## Size");
  });

  it("keeps the text a person wrote, adds this run's tickets under a dated heading, and swaps the old size section", () => {
    const existing = "Hand-written intro.\n\n## Run 2026-11-20 (wave-two)\n\n- #9 Earlier\n\n## Notes from me\nkeep this\n\n## Size\n\nold table";
    const body = mergeRollupBody(existing, finished(), "2026-11-23", "## Size\n\nnew table");
    expect(body.startsWith("Hand-written intro.")).toBe(true);
    expect(body).toContain("## Run 2026-11-20 (wave-two)\n\n- #9 Earlier");
    expect(body).toContain("## Notes from me\nkeep this");
    expect(body).toContain("## Run 2026-11-23 (wave-two)\n\n- #1 Add billing (PR #101)\n- #3 Docs (PR #103)\n\n### Human steps\n- #1: set STRIPE_KEY");
    expect(body).not.toContain("old table");
    expect(body.endsWith("## Size\n\nnew table")).toBe(true);
  });

  it("run twice on one day, it writes its own section once", () => {
    const once = mergeRollupBody("Intro", finished(), "2026-11-23", "## Size\n\nt");
    expect(mergeRollupBody(once, finished(), "2026-11-23", "## Size\n\nt")).toBe(once);
  });
});

describe("kept findings in status", () => {
  it("lists each ticket's kept P2 and P3 findings", () => {
    const s = withTicket(finished(), 1, () => ({ kept: ["P3 app/a.ts rename x", "P2 app/b.ts slow loop"] }));
    expect(statusLines(s)).toContain("kept findings (P2 and P3, never blocking):");
    expect(statusLines(s)).toContain("  #1: P2 app/b.ts slow loop");
    expect(statusLines(finished()).join("\n")).not.toContain("kept findings");
  });
});
