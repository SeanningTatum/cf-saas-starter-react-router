/**
 * Dry runs of .claude/workflows/eval-plan-feature.js. The workflow is a scorer: if a wrong edit makes
 * it pass a bad auditor answer (or fail a good one), the ticket-auditor's eval lies and nobody sees it.
 * The cases here are small and built in the test; the golden set in evals/plan-feature/ is not read.
 *
 * This workflow has no fix round (it audits and scores once), so there is nothing to test there.
 */
import { describe, expect, it } from "vitest";
import { dryRun, labels, ledgerOf, callShape, rowShape, RUN_OK, type AnswerRule, type DryRunResult } from "../../lib/workflow-dry-run";

const IDS = ["problem", "user", "fit", "duplicate", "acceptance", "non_goals", "metric", "ui_states", "data", "roles", "i18n_analytics", "errors", "non_negotiables"];
const BANDS = ["typical", "edge", "adversarial", "refuse"];
const MENTION_FIELDS = ["amended", "amended.body", "questions", "items.metric.note", "items.*.note"];

type Mention = { field: string; text: string };
type Case = {
  id: string;
  band: string;
  held_out: boolean;
  frozen: boolean;
  expect: { verdict: string; flagged: string[]; not_flagged: string[]; mentions?: Mention[] };
};
type Item = { id: string; status: string; note: string; source?: string };
type Audit = { slug: string; verdict: string; reason: string; items: Item[]; amended?: { title: string; body: string }; questions?: { text: string }[] };

/** 20 cases: case-0 and case-1 frozen, case-18 and case-19 held out, case-2..6 each mention one field. */
const CASES: Case[] = Array.from({ length: 20 }, (_, i) => {
  const id = `case-${i}`;
  const field = MENTION_FIELDS[i - 2];
  return {
    id,
    band: BANDS[i % 4],
    frozen: i < 2,
    held_out: i >= 18,
    expect: {
      verdict: ["ready", "amend", "reject"][i % 3],
      flagged: i % 2 ? ["metric", "ui_states"] : [],
      not_flagged: ["problem", "user", "fit", "data", "roles", "i18n_analytics"],
      ...(field ? { mentions: [{ field, text: `Secret-${id}` }] } : {}),
    },
  };
});
const byId = new Map(CASES.map((c) => [c.id, c]));

const SOURCES = { product: true, decision_sources: ["AGENTS.md#non-negotiables"], feature_slugs: ["auth", "admin-dashboard"] };

/**
 * An answer that should pass: every id once, flagged ids get each bad status in turn, i18n_analytics
 * is n/a, a few items are `filled` with known sources, and each mention sits in its field in upper case.
 */
function goodAudit(c: Case): Audit {
  const i = Number(c.id.slice(5));
  const items: Item[] = IDS.map((id) => ({
    id,
    status: c.expect.flagged.includes(id) ? ["missing", "guess", "fails"][i % 3] : id === "i18n_analytics" ? "n/a" : "present",
    note: `note on ${id}`,
  }));
  const fill = (id: string, source: string) => Object.assign(items.find((it) => it.id === id)!, { status: "filled", source });
  if (i === 7) fill("fit", "features/auth");
  if (i === 8) fill("data", "product; AGENTS.md#non-negotiables");
  if (i === 9) fill("roles", "admin-dashboard");

  const out: Audit = { slug: c.id, verdict: c.expect.verdict, reason: "because", items, amended: { title: "t", body: "b" }, questions: [{ text: "q?" }] };
  for (const m of c.expect.mentions ?? []) {
    const text = m.text.toUpperCase();
    if (m.field === "amended") out.amended!.title += ` ${text}`;
    if (m.field === "amended.body") out.amended!.body += ` ${text}`;
    if (m.field === "questions") out.questions!.push({ text });
    if (m.field === "items.metric.note") items.find((it) => it.id === "metric")!.note += ` ${text}`;
    // items.*.note is satisfied by the top-level reason too.
    if (m.field === "items.*.note") out.reason += ` ${text}`;
  }
  return out;
}

const wrongVerdict = (a: Audit): Audit => ({ ...a, verdict: a.verdict === "reject" ? "ready" : "reject" });

/** Answers for a full run; `override` replaces the auditor's answer for the ids it covers. */
function answers(cases: Case[] = CASES, override: Record<string, (good: Audit) => unknown> = {}): AnswerRule[] {
  return [
    ["load metadata", { cases, sources: SOURCES }],
    ["verify loaded copy", { identical: true, diff: "" }],
    [/^run:record/, RUN_OK],
    [
      /^audit /,
      ({ label }: { label: string }) => {
        const c = byId.get(label.slice("audit ".length))!;
        const good = goodAudit(c);
        return override[c.id] ? override[c.id](good) : good;
      },
    ],
  ];
}

type Row = { id: string; pass: boolean; reasons: string[] };
type Result = { score: number; total: number; degrade: boolean; gate: boolean | null; frozen_failed: string[]; cases: Row[] };
const resultOf = (r: DryRunResult) => r.result as Result;
const audits = (r: DryRunResult) => r.calls.filter((c) => c.label.startsWith("audit "));
const failing = (r: DryRunResult) => resultOf(r).cases.filter((c) => !c.pass);

describe("eval-plan-feature: a full run", () => {
  it("scores 20/20 with gate true when every answer matches; one ticket-auditor call per case, none shown its expected answers", async () => {
    // Catches: a filled item with a known source (slug, features/<slug>, several sources) or an n/a item
    // scored as a fail, a case-sensitive mention match, the top-level reason dropped from items.*.note,
    // the agentType changed, or a case's expect (here the Secret-* texts) copied into the auditor prompt.
    const r = await dryRun("eval-plan-feature", { args: {}, answers: answers() });
    const res = resultOf(r);
    expect(failing(r)).toEqual([]);
    expect(res).toMatchObject({ score: 20, total: 20, gate: true, frozen_failed: [], degrade: false });
    expect(r.phases).toEqual(["Load", "Verify load", "Audit", "Score"]);

    const calls = audits(r);
    expect(labels(calls).sort()).toEqual(CASES.map((c) => `audit ${c.id}`).sort());
    for (const call of calls) {
      expect(call.opts.agentType).toBe("ticket-auditor");
      expect(call.prompt).toContain(`"${call.label.slice(6)}"`);
      expect(call.prompt.toLowerCase()).not.toContain("secret-");
      expect(call.prompt).not.toContain("quick ticket reviewer");
    }
  });

  it("resuming with the same args replays every call from cache: no live call, same result", async () => {
    // Catches: anything that makes a prompt differ between two identical runs (a clock, an unordered
    // iteration), which would re-run and re-bill every auditor on resume.
    const first = await dryRun("eval-plan-feature", { args: {}, answers: answers() });
    const again = await dryRun("eval-plan-feature", { args: {}, answers: [], resumeFrom: first });
    expect(again.live).toEqual([]);
    expect(again.result).toEqual(first.result);
  });
});

describe("eval-plan-feature: the gate", () => {
  it.each([
    { fails: ["case-2", "case-3", "case-4", "case-5"], score: 16, gate: false, frozen_failed: [] },
    { fails: ["case-2", "case-3", "case-4"], score: 17, gate: true, frozen_failed: [] },
    { fails: ["case-0", "case-2", "case-3"], score: 17, gate: false, frozen_failed: ["case-0"] },
  ])("$score/20 with frozen failures $frozen_failed -> gate $gate", async ({ fails, score, gate, frozen_failed }) => {
    // Catches: the 17 threshold moved by one, or a frozen failure no longer vetoing the gate.
    const override = Object.fromEntries(fails.map((id) => [id, wrongVerdict]));
    const res = resultOf(await dryRun("eval-plan-feature", { args: {}, answers: answers(CASES, override) }));
    expect(res).toMatchObject({ score, total: 20, gate, frozen_failed });
  });

  it("a partial run (args.only, or held-out cases skipped) has gate null even when every case passes", async () => {
    // Catches: the total === 20 check dropped, so 18/18 or 3/3 would report a passing gate.
    const only = await dryRun("eval-plan-feature", { args: { only: ["case-2", "case-3", "case-4"] }, answers: answers() });
    expect(resultOf(only)).toMatchObject({ score: 3, total: 3, gate: null });
    expect(audits(only)).toHaveLength(3);

    const noHeld = await dryRun("eval-plan-feature", { args: { includeHeldOut: false }, answers: answers() });
    expect(resultOf(noHeld)).toMatchObject({ score: 18, total: 18, gate: null });
    expect(labels(audits(noHeld))).not.toContain("audit case-18");
  });
});

describe("eval-plan-feature: stops before any audit", () => {
  it.each([
    { name: "the copy differs from disk", verify: { identical: false, diff: "< a\n> b" }, reason: /differs/ },
    { name: "the verifier died", verify: null, reason: /differs/ },
  ])("$name -> stopped at Load, no auditor runs", async ({ verify, reason }) => {
    // Catches: the identical check loosened (truthy check, or dropped), so the eval scores a corrupted copy.
    const r = await dryRun("eval-plan-feature", {
      args: {},
      answers: [["verify loaded copy", verify], ...answers()],
    });
    expect(r.result).toMatchObject({ stopped: "Load", reason });
    expect(audits(r)).toEqual([]);
    expect(r.phases).not.toContain("Audit");
  });

  it("after a 'differs from disk' stop, a resume with args.reload loads again and finishes; without it the old load replays and stops again", async () => {
    const stopped = await dryRun("eval-plan-feature", {
      args: {},
      answers: [["verify loaded copy", { identical: false, diff: "< a\n> b" }], ...answers()],
    });
    expect(stopped.result).toMatchObject({ stopped: "Load", next: expect.stringContaining("args.reload") });

    const replayed = await dryRun("eval-plan-feature", { args: {}, answers: answers(), resumeFrom: stopped });
    expect(replayed.live).toEqual([]);
    expect(replayed.result).toMatchObject({ stopped: "Load" });

    const reloaded = await dryRun("eval-plan-feature", { args: { reload: 1 }, answers: answers(), resumeFrom: stopped });
    expect(labels(reloaded.live).slice(0, 2)).toEqual(["load metadata", "verify loaded copy"]);
    expect(reloaded.live[0]?.prompt).toContain("This is reload 1");
    expect(resultOf(reloaded)).toMatchObject({ score: 20, total: 20, gate: true });
  });

  it("without args.reload the Load prompt is unchanged, so an eval that never stopped keeps its cached load", async () => {
    const plain = await dryRun("eval-plan-feature", { args: {}, answers: answers() });
    expect(plain.calls[0]?.prompt).not.toContain("reload");
    for (const bad of [0, -1, 1.5, "2", true]) {
      const r = await dryRun("eval-plan-feature", { args: { reload: bad }, answers: answers() });
      expect({ bad, prompt: r.calls[0]?.prompt }).toEqual({ bad, prompt: plain.calls[0]?.prompt });
    }
  });

  it("a loader that died, or an `only` that selects nothing, stops at Load instead of crashing or scoring 0/0", async () => {
    const dead = await dryRun("eval-plan-feature", { args: {}, answers: [["load metadata", null]] });
    expect(dead.result).toMatchObject({ stopped: "Load" });
    expect(labels(dead.calls)).toEqual(["load metadata"]);

    const none = await dryRun("eval-plan-feature", { args: { only: ["no-such-case"] }, answers: answers() });
    expect(none.result).toMatchObject({ stopped: "Load", reason: "no cases selected" });
    expect(audits(none)).toEqual([]);
  });
});

describe("eval-plan-feature: scoring", () => {
  const item = (a: Audit, id: string) => a.items.find((it) => it.id === id)!;
  const edit = (f: (a: Audit) => unknown) => (a: Audit) => {
    f(a);
    return a;
  };
  // Each row breaks one rule on one case; the run must fail exactly that case, for that reason.
  it.each<[string, string, (a: Audit) => unknown, RegExp]>([
    ["a flagged id with a good status", "case-3", edit((a) => (item(a, "metric").status = "present")), /metric should be flagged/],
    ["a not_flagged id with a bad status", "case-10", edit((a) => (item(a, "problem").status = "guess")), /problem should not be flagged/],
    ["a wrong verdict", "case-10", wrongVerdict, /verdict/],
    ["a duplicated checklist id", "case-10", edit((a) => a.items.push({ id: "user", status: "present", note: "again" })), /user appears 2 times/],
    ["a missing checklist id", "case-10", edit((a) => (a.items = a.items.filter((it) => it.id !== "errors"))), /errors missing from items/],
    ["a filled item with an unknown source", "case-7", edit((a) => (item(a, "fit").source = "features/nope")), /fit filled with unknown source/],
    ["a filled item with no source", "case-7", edit((a) => delete item(a, "fit").source), /fit filled with unknown source/],
    ["a filled item citing one known and one unknown source", "case-8", edit((a) => (item(a, "data").source = "product; made-up")), /data filled with unknown source/],
    ["a mention that is absent", "case-3", edit((a) => (a.amended!.body = "nothing here")), /amended.body should mention/],
    ["an items.<id>.note mention found only in another item's note", "case-5", edit((a) => {
      const m = item(a, "metric");
      item(a, "problem").note += m.note;
      m.note = "plain";
    }), /items.metric.note should mention/],
  ])("%s fails that case", async (_name, id, mutate, reason) => {
    const r = await dryRun("eval-plan-feature", { args: {}, answers: answers(CASES, { [id]: mutate }) });
    const bad = failing(r);
    expect(bad.map((c) => c.id)).toEqual([id]);
    expect(bad[0].reasons.join("; ")).toMatch(reason);
    expect(resultOf(r).score).toBe(19);
  });

  it("an auditor that died (null) scores as a fail with a reason, and the other cases still score", async () => {
    // Catches: score() dereferencing a null answer, which would throw and lose the case's row detail.
    const r = await dryRun("eval-plan-feature", { args: {}, answers: answers(CASES, { "case-10": () => null }) });
    expect(failing(r)).toEqual([expect.objectContaining({ id: "case-10", reasons: ["auditor returned nothing"] })]);
    expect(resultOf(r)).toMatchObject({ score: 19, total: 20, gate: true });
  });
});

describe("eval-plan-feature: degrade", () => {
  it("args.degrade runs a general-purpose agent with the degrade note instead of the ticket-auditor", async () => {
    // Catches: the ablation silently still using the ticket-auditor, which would make it measure nothing.
    const r = await dryRun("eval-plan-feature", { args: { degrade: true }, answers: answers() });
    const calls = audits(r);
    expect(calls).toHaveLength(20);
    for (const call of calls) {
      expect(call.opts.agentType).toBe("general-purpose");
      expect(call.prompt).toContain("quick ticket reviewer");
    }
    expect(resultOf(r)).toMatchObject({ degrade: true, total: 20 });
  });
});

describe("eval-plan-feature: run ledger", () => {
  it("the last call is a run:record on the runner that lists the loader, the verifier and every audit, in order, and its check line verifies: an audit that dodges the ledger is missing from the cost report", async () => {
    const r = await dryRun("eval-plan-feature", { args: {}, answers: answers() });
    const record = r.calls.at(-1);
    if (!record) throw new Error("no calls");
    expect(record.opts).toEqual({ effort: "low", label: "run:record", phase: "Score", agentType: "runner" });
    const lg = ledgerOf(record.prompt);
    expect(lg.verifies).toBe(true);
    expect([lg.workflow, lg.slug]).toEqual(["eval-plan-feature", "eval-plan-feature"]);
    expect(rowShape(lg.rows)).toEqual(r.calls.slice(0, -1).map(callShape));
    expect(lg.rows.map((row) => row.label)).toEqual(["load metadata", "verify loaded copy", ...CASES.map((c) => `audit ${c.id}`)]);
    expect(record.prompt).toContain("Run this command from the repository root exactly as written");
  });

  it("a run that stops at Load makes no run:record call: there is nothing worth a file yet", async () => {
    const dead = await dryRun("eval-plan-feature", { args: {}, answers: [["load metadata", null]] });
    const differs = await dryRun("eval-plan-feature", { args: {}, answers: [["load metadata", { cases: CASES, sources: SOURCES }], ["verify loaded copy", { identical: false, diff: "x" }]] });
    const none = await dryRun("eval-plan-feature", { args: { only: ["no-such-case"] }, answers: answers() });
    for (const r of [dead, differs, none]) expect(labels(r.calls).filter((l) => l.startsWith("run:record"))).toEqual([]);
  });

  it("a ledger write that fails only logs: the score, the gate and the cases come back as they would have", async () => {
    const ok = await dryRun("eval-plan-feature", { args: {}, answers: answers() });
    const failed = await dryRun("eval-plan-feature", { args: {}, answers: [[/^run:record/, "bun: command not found"], ...answers()] });
    expect(failed.result).toEqual(ok.result);
    expect(failed.logs.filter((l) => l.startsWith("Run telemetry: not recorded"))).toEqual(["Run telemetry: not recorded (bun: command not found)"]);
    expect(ok.logs.filter((l) => l.startsWith("Run telemetry"))).toEqual([]);
  });
});
