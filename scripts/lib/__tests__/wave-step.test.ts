import { describe, expect, it } from "vitest";
import { MAX_PENDING_ROUNDS, MAX_THREAD_ROUNDS, SIGNATURE_MAX } from "../wave-constants";
import { type FixKind, type PlanTicketInput, type Ticket, ticketOf, type WaveState, withTicket } from "../wave-state";
import { afterMerge, applyEvent, applyGate, applyGuard, nextTicketStep, nextWaveStep, signatureOf } from "../wave-step";
import { guardOf, SHA_A, SHA_B, ticket, waveOf } from "./helpers/wave-fixture";

const tk = (s: WaveState, n: number): Ticket => ticketOf(s, n) ?? expect.fail(`#${n} is not in the state`);
const stepOf = (s: WaveState, n: number) => nextTicketStep(tk(s, n), s.reviewRounds);
const waveStep = (s: WaveState) => nextWaveStep(s).step;
const advance = (s: WaveState) => nextWaveStep(s).state;
const started = (tickets: PlanTicketInput[], over: Partial<WaveState> = {}) => advance(waveOf(tickets, over));

const opened = (s: WaveState, n: number) => applyEvent(s, { type: "opened", n, pr: 100 + n, branch: `w/${n}`, head: SHA_A, ownerSteps: [] });
const reviewed = (s: WaveState, n: number, blocking: string[] = []) => applyEvent(s, { type: "reviewed", n, blocking });
const fixed = (s: WaveState, n: number, what: FixKind, cause = "") => applyEvent(s, { type: "fixed", n, what, head: SHA_B, cause });
const failed = (s: WaveState, n: number, line: string) => applyEvent(s, { type: "failed", n, line });
const green = (s: WaveState, n: number) => applyGuard(reviewed(opened(s, n), n), n, guardOf("green"));
const red = (s: WaveState, n: number) => applyGuard(s, n, guardOf("red", { line: "red checks: unit" }));

describe("signatureOf", () => {
  it("the same failure from two worktrees, shas and line numbers has one signature; a different failure does not", () => {
    const a = signatureOf("Error at /Users/a/wt-1/app/lib/x.ts:12 in abc1234def");
    expect(a).toBe(signatureOf("ERROR  at /home/ci/wt-9/app/lib/x.ts:99 in 0123456789abcdef0123456789abcdef01234567"));
    expect(a).not.toBe(signatureOf("Error at /Users/a/wt-1/app/lib/y.ts:12 in abc1234def"));
    expect(signatureOf("x".repeat(SIGNATURE_MAX + 40))).toHaveLength(SIGNATURE_MAX);
  });

  it("two lines that differ only in a number have one signature, whatever the number's length", () => {
    expect(signatureOf("timed out after 1234567 ms")).toBe(signatureOf("timed out after 123456 ms"));
  });
});

describe("opened", () => {
  it("a PR number another ticket already holds makes the ticket stuck instead of tying one PR to two tickets", () => {
    let s = opened(started([ticket(1), ticket(2)]), 1);
    s = applyEvent(s, { type: "opened", n: 2, pr: 101, branch: "w/2", head: SHA_A, ownerSteps: [] });
    expect(tk(s, 2)).toMatchObject({ status: "stuck", why: "PR #101 already belongs to another ticket in this wave" });
  });
});

describe("review rounds", () => {
  it("with one round, a clean review goes straight to the guard", () => {
    const s = reviewed(opened(started([ticket(1)]), 1), 1);
    expect(stepOf(s, 1)).toBe("guard");
  });

  it("with one round, a P0/P1 leads to a fix, a second review, and never a third even when the second still blocks", () => {
    let s = opened(started([ticket(1)]), 1);
    expect(stepOf(s, 1)).toBe("review");
    s = reviewed(s, 1, ["P1: leaks the token"]);
    expect(stepOf(s, 1)).toBe("fix-review");
    expect(tk(s, 1).findings).toEqual(["P1: leaks the token"]);
    s = fixed(s, 1, "review");
    expect(stepOf(s, 1)).toBe("review");
    expect(tk(s, 1).findings).toEqual([]);
    s = reviewed(s, 1, ["P1: still leaks"]);
    expect(stepOf(s, 1)).toBe("fix-review");
    s = fixed(s, 1, "review");
    expect(stepOf(s, 1)).toBe("guard");
  });

  it("with zero rounds an opened PR skips review", () => {
    expect(stepOf(opened(started([ticket(1)], { reviewRounds: 0 }), 1), 1)).toBe("guard");
  });
});

describe("applyGuard", () => {
  it("a check that fails twice makes the ticket stuck; once asks for a check fix", () => {
    let s = red(reviewed(opened(started([ticket(1)]), 1), 1), 1);
    expect(stepOf(s, 1)).toBe("fix-check");
    s = fixed(s, 1, "check");
    expect(stepOf(s, 1)).toBe("guard");
    s = red(s, 1);
    expect(tk(s, 1)).toMatchObject({ status: "stuck", checkFailures: 2, why: "a check failed twice: red checks: unit" });
  });

  it("checks pending for the round limit count as one failed check, not a stuck ticket", () => {
    let s = reviewed(opened(started([ticket(1)]), 1), 1);
    for (let i = 1; i < MAX_PENDING_ROUNDS; i++) s = applyGuard(s, 1, guardOf("pending"));
    expect(tk(s, 1)).toMatchObject({ status: "open", pendingRounds: MAX_PENDING_ROUNDS - 1, checkFailures: 0 });
    s = applyGuard(s, 1, guardOf("pending"));
    expect(tk(s, 1)).toMatchObject({ status: "open", pendingRounds: 0, checkFailures: 1, needsCheckFix: true });
  });

  it("unanswered threads ask for answers each round, and stick the ticket once the round limit is spent", () => {
    let s = reviewed(opened(started([ticket(1)]), 1), 1);
    for (let i = 0; i < MAX_THREAD_ROUNDS; i++) {
      s = applyGuard(s, 1, guardOf("threads"));
      expect(stepOf(s, 1)).toBe("answer-threads");
      s = fixed(s, 1, "threads");
    }
    s = applyGuard(s, 1, guardOf("threads"));
    expect(tk(s, 1).status).toBe("stuck");
  });

  it("a closed PR sticks the ticket with the guard's line, and a PR merged by hand counts as merged", () => {
    const s = reviewed(opened(started([ticket(1), ticket(2)]), 1), 1);
    expect(tk(applyGuard(s, 1, guardOf("closed", { line: "the PR's base is main" })), 1)).toMatchObject({ status: "stuck", why: "the PR's base is main" });
    expect(tk(applyGuard(s, 1, guardOf("merged")), 1).status).toBe("merged");
    expect(tk(applyGuard(s, 1, guardOf("green")), 1).head).toBe(SHA_B);
  });
});

describe("shared failure", () => {
  it("the same cause in two tracks halts the wave and the next step names the signature and both tickets", () => {
    let s = started([ticket(1), ticket(2)]);
    s = fixed(opened(s, 1), 1, "check", "FAIL /a/wt/app/db.ts:3 missing binding DB");
    expect(s.halt).toBeNull();
    s = fixed(opened(s, 2), 2, "check", "FAIL /b/wt/app/db.ts:9 missing binding DB");
    expect(waveStep(s)).toEqual({ kind: "stop", stop: "shared-failure", signature: "fail …/db.ts:0 missing binding db", tickets: [1, 2] });
  });

  it("the same cause twice in one track is that track's own problem and does not halt", () => {
    let s = started([ticket(1, { files: ["app/db.ts"] }), ticket(2, { files: ["app/db.ts"] })]);
    s = fixed(opened(s, 1), 1, "check", "missing binding DB");
    s = fixed(s, 2, "check", "missing binding DB");
    expect(s.halt).toBeNull();
    expect(waveStep(s)).toMatchObject({ kind: "tickets" });
  });

  it("a failed build sticks its ticket; the same line in a second track halts and frees both, so resume needs no retry", () => {
    let s = started([ticket(1), ticket(2)]);
    s = failed(s, 1, "bun install failed");
    expect(tk(s, 1).status).toBe("stuck");
    s = failed(s, 2, "bun install failed");
    expect(s.halt).toEqual({ signature: "bun install failed", tickets: [1, 2] });
    expect(tk(s, 1).status).toBe("queued");
    expect(tk(s, 2).status).toBe("queued");
  });

  it("once halted, an unrelated failure still sticks its ticket instead of hiding behind the halt", () => {
    let s = started([ticket(1), ticket(2), ticket(3)]);
    s = failed(failed(s, 1, "bun install failed"), 2, "bun install failed");
    s = failed(s, 3, "typecheck: cannot find name widget");
    expect(tk(s, 3).status).toBe("stuck");
  });
});

describe("merge", () => {
  it("a refused merge sends the ticket back to open for a refresh; a second refusal sticks it", () => {
    let s = green(started([ticket(1)]), 1);
    expect(waveStep(s)).toEqual({ kind: "merge", batch: 0 });
    s = afterMerge(s, [], [{ n: 1, why: "conflicts with the wave branch" }]);
    expect(tk(s, 1)).toMatchObject({ status: "open", refresh: true });
    expect(stepOf(s, 1)).toBe("refresh");
    s = applyGuard(fixed(s, 1, "refresh"), 1, guardOf("green"));
    s = afterMerge(s, [], [{ n: 1, why: "conflicts with the wave branch" }]);
    expect(tk(s, 1)).toMatchObject({ status: "stuck", why: "could not merge after 2 tries: conflicts with the wave branch" });
  });

  it("a ticket refused for the first time on the batch's second merge pass gets a refresh, not stuck", () => {
    let s = green(green(started([ticket(1), ticket(2)]), 2), 1);
    s = applyGuard(
      withTicket(s, 2, () => ({ status: "open" })),
      2,
      guardOf("pending"),
    );
    s = afterMerge(s, [], [{ n: 1, why: "conflicts with the wave branch" }]);
    s = applyGuard(applyGuard(fixed(s, 1, "refresh"), 1, guardOf("green")), 2, guardOf("green"));
    s = afterMerge(s, [1], [{ n: 2, why: "conflicts with the wave branch" }]);
    expect(tk(s, 2)).toMatchObject({ status: "open", refresh: true });
  });
});

describe("kept findings", () => {
  it("a review keeps its P2 and P3 findings on the ticket without blocking it, once each across rounds", () => {
    let s = opened(started([ticket(1)]), 1);
    s = applyEvent(s, { type: "reviewed", n: 1, blocking: [], kept: ["P3 a", "P2 b"] });
    s = applyEvent(s, { type: "reviewed", n: 1, blocking: [], kept: ["P3 a", "P3 c"] });
    expect(tk(s, 1).kept).toEqual(["P3 a", "P2 b", "P3 c"]);
    expect(tk(s, 1).needsFix).toBe(false);
  });
});

describe("nextWaveStep", () => {
  it("a stuck ticket stops the wave only after the batch's green tickets are merged and gated", () => {
    let s = started([ticket(1), ticket(2), ticket(3)]);
    s = red(fixed(red(reviewed(opened(s, 1), 1), 1), 1, "check"), 1);
    s = green(s, 2);
    expect(waveStep(s)).toEqual({ kind: "merge", batch: 0 });
    s = afterMerge(s, [2], []);
    expect(waveStep(s)).toEqual({ kind: "gate", batch: 0 });
    s = applyGate(s, SHA_A, 0, "");
    const next = nextWaveStep(s);
    expect(next.step).toMatchObject({ kind: "stop", stop: "stuck", tickets: [{ n: 1, status: "stuck" }] });
    expect(next.state.batchesDone).toBe(1);
  });

  it("a red gate runs again once, then stops with its log", () => {
    let s = afterMerge(green(started([ticket(1)]), 1), [1], []);
    s = applyGate(s, SHA_A, 1, ".verify/wave-two/gate.log");
    expect(waveStep(s)).toEqual({ kind: "gate", batch: 0 });
    s = applyGate(s, SHA_A, 1, ".verify/wave-two/gate.log");
    expect(waveStep(s)).toEqual({ kind: "stop", stop: "gate", batch: 0, log: ".verify/wave-two/gate.log" });
  });

  it("a batch with nothing merged closes without a gate and stops on its stuck ticket", () => {
    const s = failed(started([ticket(1), ticket(2, { blockedBy: [1] })]), 1, "cannot build");
    const next = nextWaveStep(s);
    expect(next.step).toMatchObject({ kind: "stop", stop: "stuck", tickets: [{ n: 1 }] });
    expect(next.state.batch).toMatchObject({ closed: true, gate: "" });
  });

  it("walks plan, approval, both batches and the roll-up in order, and keeps the second batch for the blocked ticket", () => {
    const fresh = waveOf([ticket(1), ticket(2, { blockedBy: [1] })]);
    expect(waveStep({ ...fresh, tracks: [] })).toEqual({ kind: "plan" });
    expect(waveStep({ ...fresh, planApproved: false })).toEqual({ kind: "stop", stop: "plan", pr: null });
    let s = advance(fresh);
    expect(s.batch?.tickets).toEqual([1]);
    s = advance(applyGate(afterMerge(green(s, 1), [1], []), SHA_A, 0, ""));
    expect(s.batch).toMatchObject({ index: 1, tickets: [2] });
    expect(waveStep(applyGate(afterMerge(green(s, 2), [2], []), SHA_A, 0, ""))).toEqual({ kind: "rollup" });
    expect(waveStep({ ...s, tickets: s.tickets.map((t) => ({ ...t, status: "merged" as const })), batch: null, rollupPr: 900 })).toEqual({
      kind: "stop",
      stop: "rollup",
      pr: 900,
    });
  });

  it("a paused wave stops before anything else, even a halt", () => {
    const s = { ...started([ticket(1)]), paused: true, halt: { signature: "x", tickets: [1] } };
    expect(nextWaveStep(s)).toEqual({ state: s, step: { kind: "stop", stop: "paused", pr: null } });
  });

  it("an event for a ticket outside the wave changes nothing", () => {
    const s = started([ticket(1)]);
    expect(applyEvent(s, { type: "failed", n: 42, line: "boom" })).toBe(s);
  });
});
