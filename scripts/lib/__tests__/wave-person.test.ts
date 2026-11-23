import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { dependentsOf, pause, type PersonChange, resume, retry, skip } from "../wave-person";
import { ticketOf, type WaveState, withTicket } from "../wave-state";
import { afterMerge, applyEvent, applyGate, applyGuard, nextWaveStep } from "../wave-step";
import { guardOf, SHA_A, ticket, waveOf } from "./helpers/wave-fixture";

const changed = (e: Either.Either<PersonChange, string>): PersonChange => (Either.isRight(e) ? e.right : expect.fail(e.left));
const refusal = (e: Either.Either<PersonChange, string>): string => (Either.isLeft(e) ? e.left : expect.fail("the change was accepted"));
const statusOf = (s: WaveState, n: number) => ticketOf(s, n)?.status;
const running = () => nextWaveStep(waveOf([ticket(1), ticket(2), ticket(3)])).state;

describe("pause and resume", () => {
  it("a paused wave stops at its next step, and resume carries on with the same batch", () => {
    const before = running();
    const paused = pause(before);
    expect(paused.message).toBe("wave-two paused; the run stops at its next step");
    expect(nextWaveStep(paused.state).step).toEqual({ kind: "stop", stop: "paused", pr: null });
    expect(before.paused).toBe(false);
    const resumed = resume(paused.state).state;
    expect(nextWaveStep(resumed).step).toMatchObject({ kind: "tickets", batch: 0, tickets: [{ n: 1 }, { n: 2 }] });
  });

  it("resume clears a shared-failure halt and forgets that failure, but keeps other failures on record", () => {
    let s = running();
    s = applyEvent(s, { type: "fixed", n: 1, what: "check", head: SHA_A, cause: "port 8787 in use" });
    s = applyEvent(s, { type: "fixed", n: 3, what: "check", head: SHA_A, cause: "unrelated flake" });
    s = applyEvent(s, { type: "fixed", n: 2, what: "check", head: SHA_A, cause: "port 9229 in use" });
    expect(nextWaveStep(s).step).toMatchObject({ kind: "stop", stop: "shared-failure", tickets: [1, 2] });
    const resumed = resume(s).state;
    expect(resumed.halt).toBeNull();
    expect(resumed.failures.map((f) => f.signature)).toEqual(["unrelated flake"]);
    expect(nextWaveStep(resumed).step).toMatchObject({ kind: "tickets", batch: 0 });
  });

  it("resume after a red gate lets the gate run again; a passed gate is left as it is", () => {
    let s = nextWaveStep(waveOf([ticket(1)])).state;
    s = applyGuard(applyEvent(s, { type: "reviewed", n: 1, blocking: [] }), 1, guardOf("green"));
    s = afterMerge(s, [1], []);
    s = applyGate(applyGate(s, SHA_A, 1, "gate.log"), SHA_A, 1, "gate.log");
    expect(nextWaveStep(s).step).toMatchObject({ kind: "stop", stop: "gate" });
    const resumed = resume(s).state;
    expect(resumed.batch).toMatchObject({ gate: "", gateFailures: 0 });
    expect(nextWaveStep(resumed).step).toEqual({ kind: "gate", batch: 0 });
    const passed = applyGate(resumed, SHA_A, 0, "");
    expect(resume(passed).state.batch).toMatchObject({ gate: "pass" });
  });
});

describe("retry", () => {
  it("a stuck ticket with no PR is built again from scratch; one with a PR is refreshed on that PR", () => {
    const s = withTicket(running(), 1, () => ({ status: "stuck", checkFailures: 2, threadRounds: 3, why: "a check failed twice" }));
    expect(ticketOf(changed(retry(s, 1)).state, 1)).toMatchObject({ status: "queued", checkFailures: 0, threadRounds: 0, why: "" });
    const withPr = withTicket(s, 1, () => ({ pr: 101 }));
    expect(ticketOf(changed(retry(withPr, 1)).state, 1)).toMatchObject({ status: "open", refresh: true, pr: 101, checkFailures: 0 });
  });

  it("only a stuck ticket in this wave can be retried", () => {
    expect(refusal(retry(running(), 1))).toBe("#1 is queued, not stuck");
    expect(refusal(retry(running(), 42))).toBe("#42 is not in this wave");
  });
});

describe("skip", () => {
  it("skipping a ticket also skips every ticket blocked by it, directly or not, and says which", () => {
    const s = waveOf([ticket(1), ticket(2, { blockedBy: [1] }), ticket(3, { blockedBy: [2] }), ticket(4)]);
    const out = changed(skip(s, 1));
    expect(out.message).toBe("skipped #1, #2, #3");
    expect([1, 2, 3, 4].map((n) => statusOf(out.state, n))).toEqual(["skipped", "skipped", "skipped", "queued"]);
    expect(ticketOf(out.state, 3)?.why).toBe("blocked by skipped #1");
  });

  it("a merged dependant is never un-merged by a skip", () => {
    const s = withTicket(waveOf([ticket(1), ticket(2, { blockedBy: [1] })]), 2, () => ({ status: "merged" }));
    expect(dependentsOf(s, 1)).toEqual([1]);
    expect(statusOf(changed(skip(s, 1)).state, 2)).toBe("merged");
  });

  it("a merged or unknown ticket cannot be skipped", () => {
    const s = withTicket(waveOf([ticket(1)]), 1, () => ({ status: "merged" }));
    expect(refusal(skip(s, 1))).toBe("#1 is already merged");
    expect(refusal(skip(s, 9))).toBe("#9 is not in this wave");
  });

  it("after a skip the wave moves past the skipped tickets to the roll-up", () => {
    const s = changed(skip(waveOf([ticket(1), ticket(2, { blockedBy: [1] })]), 1)).state;
    expect(nextWaveStep(s).step).toEqual({ kind: "rollup" });
  });
});
