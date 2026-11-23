import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { nextBatch, type PlanTicket, pathsOverlap, planWave, type WavePlan } from "../wave-plan";

const t = (n: number, over: Partial<PlanTicket> = {}): PlanTicket => ({ n, blockedBy: [], files: [`app/f${n}.ts`], wide: false, ...over });

const planned = (tickets: PlanTicket[], max: number): WavePlan => {
  const made = planWave(tickets, max);
  if (Either.isLeft(made)) expect.fail(made.left);
  return made.right;
};

const refused = (tickets: PlanTicket[], max = 8): string => {
  const made = planWave(tickets, max);
  if (Either.isRight(made)) expect.fail("the plan was accepted");
  return made.left;
};

describe("pathsOverlap", () => {
  it("a folder covers the files under it but not a sibling that shares its prefix", () => {
    expect(pathsOverlap("app/lib", "app/lib/a.ts")).toBe(true);
    expect(pathsOverlap("app/lib/", "app/lib/a.ts")).toBe(true);
    expect(pathsOverlap("app/lib/a.ts", "app/lib")).toBe(true);
    expect(pathsOverlap("app/lib", "app/library.ts")).toBe(false);
    expect(pathsOverlap("app/lib/a.ts", "app/lib/b.ts")).toBe(false);
  });
});

describe("planWave", () => {
  it("more tickets than tracks at once spill into a second batch, lowest numbers first", () => {
    const plan = planned([t(1), t(2), t(3)], 2);
    expect(plan.tracks).toEqual([
      { id: "t1", tickets: [1] },
      { id: "t2", tickets: [2] },
      { id: "t3", tickets: [3] },
    ]);
    expect(plan.batches).toEqual([[1, 2], [3]]);
  });

  it("a track follows blockers that sit outside it: #3 then #2 then #1 starts, where ordering the track alone would refuse it", () => {
    const tickets = [t(1, { files: ["src/shared.ts"], blockedBy: [2] }), t(2, { blockedBy: [3] }), t(3, { files: ["src/shared.ts"] })];
    const plan = planned(tickets, 2);
    expect(plan.tracks.find((x) => x.tickets.includes(1))?.tickets).toEqual([3, 1]);
    expect(plan.batches).toEqual([[3], [2], [1]]);
  });

  it("a blocker in another track holds its dependant back one batch even when there is room", () => {
    expect(planned([t(1), t(2, { blockedBy: [1] })], 8).batches).toEqual([[1], [2]]);
  });

  it("tickets that share a file, or a folder and a file in it, land in one track with the blocker first", () => {
    const plan = planned(
      [t(4, { files: ["app/lib/a.ts"], blockedBy: [7] }), t(7, { files: ["app/lib/a.ts"] }), t(5, { files: ["app/x"] }), t(6, { files: ["app/x/y.ts"] })],
      8,
    );
    expect(plan.tracks).toEqual([
      { id: "t1", tickets: [7, 4] },
      { id: "t2", tickets: [5, 6] },
    ]);
    expect(plan.batches).toEqual([
      [5, 7],
      [4, 6],
    ]);
  });

  it("a track with more tickets left starts first when tracks at once is the limit", () => {
    const plan = planned([t(1), t(2, { files: ["app/shared.ts"] }), t(3, { files: ["app/shared.ts"] })], 1);
    expect(plan.batches).toEqual([[2], [1], [3]]);
  });

  it("a wide ticket gets its own track, glues no other tickets together and runs alone after every narrow ticket", () => {
    const plan = planned([t(1, { wide: true, files: ["app"] }), t(2), t(3)], 8);
    expect(plan.tracks).toEqual([
      { id: "t1", tickets: [1] },
      { id: "t2", tickets: [2] },
      { id: "t3", tickets: [3] },
    ]);
    expect(plan.batches).toEqual([[2, 3], [1]]);
  });

  it("two wide tickets each run alone, in number order", () => {
    expect(planned([t(9, { wide: true }), t(8, { wide: true }), t(1)], 8).batches).toEqual([[1], [8], [9]]);
  });

  it("a blocker loop is refused and named, so the run never waits forever on it", () => {
    expect(refused([t(1, { blockedBy: [2] }), t(2, { blockedBy: [1] })])).toBe("tickets #1, #2 block each other; break the loop before planning");
    expect(refused([t(1, { blockedBy: [3] }), t(2, { blockedBy: [1] }), t(3, { blockedBy: [2] })])).toContain("block each other");
  });

  it("a blocker outside the wave becomes a note and counts as done, so its ticket starts in the first batch", () => {
    const plan = planned([t(5, { blockedBy: [99] })], 8);
    expect(plan.notes).toEqual(["#5 is blocked by #99, which is not in this wave: treated as done"]);
    expect(plan.batches).toEqual([[5]]);
  });

  it("an empty wave and a ticket listed twice are refused", () => {
    expect(refused([])).toBe("the wave has no tickets");
    expect(refused([t(1), t(1)])).toBe("ticket #1 is listed twice");
  });

  it("a ticket that names itself as a blocker is not a loop and still starts", () => {
    expect(planned([t(1, { blockedBy: [1] })], 8).batches).toEqual([[1]]);
  });

  it("planning leaves the caller's ticket list in its order", () => {
    const tickets = [t(3), t(1), t(2)];
    planned(tickets, 1);
    expect(tickets.map((x) => x.n)).toEqual([3, 1, 2]);
  });
});

describe("nextBatch", () => {
  const tracks = [
    { id: "t1", tickets: [1, 2] },
    { id: "t2", tickets: [3] },
    { id: "t3", tickets: [4] },
  ];
  const tickets = [t(1), t(2), t(3), t(4, { blockedBy: [1] }), t(9, { wide: true })];
  const all = [...tracks, { id: "t4", tickets: [9] }];

  it("a stuck head stops its own track and every ticket it blocks, but not the other tracks", () => {
    expect(nextBatch({ tracks: all, tickets, done: new Set(), blocked: new Set([1]), max: 8 })).toEqual([3]);
  });

  it("the wide ticket waits while any narrow ticket is unsettled, even a stuck one", () => {
    expect(nextBatch({ tracks: all, tickets, done: new Set([1, 2, 3]), blocked: new Set([4]), max: 8 })).toEqual([]);
    expect(nextBatch({ tracks: all, tickets, done: new Set([1, 2, 3, 4]), blocked: new Set(), max: 8 })).toEqual([9]);
  });

  it("a settled blocker frees its dependant and the track moves to its next ticket", () => {
    expect(nextBatch({ tracks: all, tickets, done: new Set([1]), blocked: new Set(), max: 8 })).toEqual([2, 3, 4]);
  });
});
