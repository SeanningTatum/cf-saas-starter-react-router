import { describe, expect, it } from "vitest";
import type { AnyStateMachine } from "xstate";
import { fileUploadMachine } from "@/components/file-upload.machine";
import { checkMachine } from "../machine-check";
import { CHECK } from "../machine-constants";
import {
  alwaysIntoWorkMachine,
  alwaysSpawnMachine,
  deadEndMachine,
  delayedMachine,
  invokesOnStartMachine,
  nestedDeadEndMachine,
  nestedMachine,
  parallelMachine,
  parallelTargetMachine,
  soundMachine,
  spawnsOnStartMachine,
  toFinalMachine,
  trappedChildMachine,
  unreachableMachine,
} from "./fixtures/machines";

const found = (machine: AnyStateMachine) => checkMachine(machine).map(({ check, state }) => ({ check, state }));

describe("checkMachine self-test: each check fails on a bad machine", () => {
  it("names a state no transition reaches, so a leftover state cannot hide in a machine", () => {
    expect(found(unreachableMachine)).toEqual([{ check: CHECK.unreachable, state: "orphan" }]);
  });

  it("names a state with no way back to the initial state that is not final, so a component cannot get stuck", () => {
    expect(found(deadEndMachine)).toEqual([{ check: CHECK.deadEnd, state: "stuck" }]);
  });

  it("names every nested state that cannot leave its parent, so a dead end inside a compound state is caught too", () => {
    expect(found(nestedDeadEndMachine)).toEqual([
      { check: CHECK.deadEnd, state: "editing.draft" },
      { check: CHECK.deadEnd, state: "editing.review" },
    ]);
  });

  it("names an initial state that invokes an actor, so useMachine never starts work during the server render", () => {
    expect(found(invokesOnStartMachine)).toEqual([{ check: CHECK.startsWork, state: "loading" }]);
  });

  it("follows eventless transitions from the initial state, so an always hop into an invoking state is caught", () => {
    expect(found(alwaysIntoWorkMachine)).toEqual([{ check: CHECK.startsWork, state: "loading" }]);
  });

  it("names an initial state that spawns a child on entry, so a spawnChild action cannot bypass the invoke check", () => {
    expect(found(spawnsOnStartMachine)).toEqual([{ check: CHECK.startsWork, state: "idle" }]);
  });

  it("does not let a parent's onDone rescue a child that can never finish, so a trapped child state is still caught", () => {
    expect(found(trappedChildMachine)).toEqual([{ check: CHECK.deadEnd, state: "editing.stuck" }]);
  });

  it("names an initial state whose eventless transition spawns a child, so a spawn on an always hop is caught", () => {
    expect(found(alwaysSpawnMachine)).toEqual([{ check: CHECK.startsWork, state: "checking" }]);
  });

  it("says what to do instead in every finding, so the author is never left with only a complaint", () => {
    const all = [unreachableMachine, deadEndMachine, invokesOnStartMachine, spawnsOnStartMachine].flatMap(checkMachine);
    expect(all.length).toBe(4);
    for (const finding of all) {
      expect(finding.message.length).toBeGreaterThan(0);
      expect(finding.fix.length).toBeGreaterThan(0);
    }
    expect(checkMachine(invokesOnStartMachine)[0]?.message).toContain('"work"');
  });
});

describe("checkMachine passes sound machines", () => {
  it.each([
    ["a flat machine with an invoke, a cancel and a final state", soundMachine],
    ["a compound state whose parent transitions and onDone lead back", nestedMachine],
    ["a state whose only way out is a final state", toFinalMachine],
    ["a parallel machine whose regions each toggle back", parallelMachine],
    ["a transition into one region of a parallel state, which enters the other regions too", parallelTargetMachine],
    ["a delayed transition back to the initial state, beside a targetless one", delayedMachine],
  ])("passes %s, so a correct shape is not flagged", (_name, machine) => {
    expect(found(machine)).toEqual([]);
  });

  it("passes the file-upload pilot, the machine every later one copies", () => {
    expect(found(fileUploadMachine)).toEqual([]);
  });
});
