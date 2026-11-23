import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { MAX_TEXT, MAX_TICKETS } from "../wave-constants";
import { decodeEvent, decodePlanInput, decodeState, ticketOf, withLog, withTicket } from "../wave-state";
import { SHA_A, ticket, waveOf } from "./helpers/wave-fixture";

const leftOf = <A>(e: Either.Either<A, string>): string => {
  if (Either.isRight(e)) return expect.fail("decoded, expected a refusal");
  return e.left;
};

const stateText = (over: Record<string, unknown>) => JSON.stringify({ ...waveOf([ticket(1), ticket(2)]), ...over });

describe("decodeState", () => {
  it("a state the CLI wrote decodes back to the same value, so a saved run can be picked up again", () => {
    const state = waveOf([ticket(1), ticket(2, { blockedBy: [1] })]);
    expect(decodeState(JSON.stringify(state))).toEqual(Either.right(state));
  });

  it("an unknown key is refused, so a hand-edited typo cannot be silently dropped on the next save", () => {
    expect(leftOf(decodeState(stateText({ pasued: true })))).toContain("pasued");
  });

  it("tracks at once stays from 1 to 8 and review rounds from 0 to 3, and the refusal names the field", () => {
    expect(Either.isRight(decodeState(stateText({ tracksAtOnce: 8, reviewRounds: 3 })))).toBe(true);
    expect(Either.isRight(decodeState(stateText({ tracksAtOnce: 1, reviewRounds: 0 })))).toBe(true);
    expect(leftOf(decodeState(stateText({ tracksAtOnce: 9 })))).toMatch(/^tracksAtOnce: /);
    expect(leftOf(decodeState(stateText({ tracksAtOnce: 0 })))).toMatch(/^tracksAtOnce: /);
    expect(leftOf(decodeState(stateText({ reviewRounds: 4 })))).toMatch(/^reviewRounds: /);
  });

  it("a state from another version or with a bad slug is refused rather than read with the wrong rules", () => {
    expect(leftOf(decodeState(stateText({ version: 2 })))).toMatch(/^version: /);
    expect(leftOf(decodeState(stateText({ slug: "Wave Two" })))).toMatch(/^slug: /);
  });

  it("text that is not JSON is a refusal, not a crash", () => {
    expect(typeof leftOf(decodeState("{not json"))).toBe("string");
  });
});

describe("decodePlanInput", () => {
  it("changes defaults to empty and a ticket keeps its fields", () => {
    const input = decodePlanInput(JSON.stringify({ tickets: [ticket(1)] }));
    expect(input).toEqual(Either.right({ tickets: [ticket(1)], changes: "" }));
  });

  it("an empty list and a list over the ticket cap are refused", () => {
    expect(leftOf(decodePlanInput(JSON.stringify({ tickets: [] })))).toMatch(/^tickets: /);
    const many = Array.from({ length: MAX_TICKETS + 1 }, (_, i) => ticket(i + 1));
    expect(leftOf(decodePlanInput(JSON.stringify({ tickets: many })))).toMatch(/^tickets: /);
    const most = Array.from({ length: MAX_TICKETS }, (_, i) => ticket(i + 1));
    expect(Either.isRight(decodePlanInput(JSON.stringify({ tickets: most })))).toBe(true);
  });

  it("a ticket number of 0 or an unknown kind is refused with its path", () => {
    expect(leftOf(decodePlanInput(JSON.stringify({ tickets: [ticket(0)] })))).toMatch(/^tickets\.0\.n: /);
    expect(leftOf(decodePlanInput(JSON.stringify({ tickets: [{ ...ticket(1), kind: "chore" }] })))).toMatch(/^tickets\.0\.kind: /);
  });
});

describe("decodeEvent", () => {
  it("each event type decodes, and fixed without a cause gets an empty cause", () => {
    const opened = { type: "opened", n: 1, pr: 101, branch: "w/1", head: SHA_A, ownerSteps: ["set the secret"] };
    expect(decodeEvent(JSON.stringify(opened))).toEqual(Either.right(opened));
    expect(decodeEvent(JSON.stringify({ type: "fixed", n: 1, what: "check", head: SHA_A }))).toEqual(
      Either.right({ type: "fixed", n: 1, what: "check", head: SHA_A, cause: "" }),
    );
    expect(Either.isRight(decodeEvent(JSON.stringify({ type: "reviewed", n: 1, blocking: [] })))).toBe(true);
    expect(Either.isRight(decodeEvent(JSON.stringify({ type: "failed", n: 1, line: "boom" })))).toBe(true);
  });

  it("an unknown type, an unknown fix kind, a bad branch and an extra key are refused", () => {
    leftOf(decodeEvent(JSON.stringify({ type: "merged", n: 1 })));
    leftOf(decodeEvent(JSON.stringify({ type: "fixed", n: 1, what: "everything", head: SHA_A })));
    leftOf(decodeEvent(JSON.stringify({ type: "opened", n: 1, pr: 101, branch: "a..b", head: SHA_A, ownerSteps: [] })));
    leftOf(decodeEvent(JSON.stringify({ type: "failed", n: 1, line: "boom", extra: 1 })));
  });

  it("a failure line over the text cap is refused, so no event can bloat the state file", () => {
    leftOf(decodeEvent(JSON.stringify({ type: "failed", n: 1, line: "x".repeat(MAX_TEXT + 1) })));
    expect(Either.isRight(decodeEvent(JSON.stringify({ type: "failed", n: 1, line: "x".repeat(MAX_TEXT) })))).toBe(true);
  });
});

describe("withTicket and withLog", () => {
  it("change one ticket and leave the state they were given untouched", () => {
    const state = waveOf([ticket(1), ticket(2)]);
    const next = withTicket(state, 2, () => ({ status: "open" }));
    expect(ticketOf(next, 2)?.status).toBe("open");
    expect(ticketOf(next, 1)?.status).toBe("queued");
    expect(ticketOf(state, 2)?.status).toBe("queued");
    const logged = withLog(state, "y".repeat(MAX_TEXT + 20));
    expect(logged.log).toEqual(["y".repeat(MAX_TEXT)]);
    expect(state.log).toEqual([]);
  });
});
