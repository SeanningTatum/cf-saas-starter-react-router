import { describe, expect, it } from "vitest";
import type { AnyStateMachine, AnyStateNode } from "xstate";
import { EVENT_PREFIX, INLINE_GUARD } from "../machine-constants";
import { closure, descend, enter, guardName, machineEdges, stateNodes, statePath } from "../machine-graph";
import { delayedMachine, guardedMachine, historyMachine, nestedMachine, parallelMachine, soundMachine } from "./fixtures/machines";

const edges = (machine: AnyStateMachine) =>
  machineEdges(machine).map(({ source, target, event, guard }) => [statePath(source), statePath(target), event, guard]);
const paths = (nodes: Iterable<AnyStateNode>) => [...new Set([...nodes].map(statePath))].sort();
const node = (machine: AnyStateMachine, path: string): AnyStateNode => machine.getStateNodeById(`${machine.id}.${path}`);

describe("guardName", () => {
  it.each([
    ["no guard", undefined, undefined],
    ["a named guard", "isValid", "isValid"],
    ["a guard object", { type: "isValid", params: { min: 1 } }, "isValid"],
    ["an inline function", () => true, INLINE_GUARD],
    ["an object with no type", { params: {} }, INLINE_GUARD],
  ])("names %s readably, so an edge label never prints [object Object] or a function body", (_name, guard, expected) => {
    expect(guardName(guard)).toBe(expected);
  });
});

describe("machineEdges", () => {
  it("lists invoke done and error edges beside event edges, so a state reached only when an actor settles is not called unreachable", () => {
    const actor = node(soundMachine, "loading").invoke[0]?.id;
    expect(edges(soundMachine)).toEqual([
      ["idle", "loading", "LOAD", undefined],
      ["idle", "closed", "CLOSE", undefined],
      ["loading", "idle", "CANCEL", undefined],
      ["loading", "ready", `${EVENT_PREFIX.doneActor}${actor}`, undefined],
      ["loading", "failed", `${EVENT_PREFIX.errorActor}${actor}`, undefined],
      ["ready", "idle", "RESET", undefined],
      ["failed", "loading", "RETRY", undefined],
      ["failed", "closed", "CLOSE", undefined],
    ]);
  });

  it("keeps a delayed edge and drops a targetless one, so an after transition counts as a way out and an action-only handler is not a self-loop", () => {
    expect(edges(delayedMachine)).toEqual([
      ["idle", "shown", "SHOW", undefined],
      ["shown", "idle", `${EVENT_PREFIX.after}3000.delayed.shown`, undefined],
    ]);
  });

  it("adds each always edge once with its guard, so an eventless hop is followed, not doubled, and every guard reaches the edge", () => {
    expect(edges(guardedMachine)).toEqual([
      ["idle", "sent", "SUBMIT", "isValid"],
      ["idle", "sent", "SUBMIT", "isValid"],
      ["idle", "idle", "SUBMIT", INLINE_GUARD],
      ["sent", "idle", "", "isValid"],
    ]);
  });
});

describe("descend and enter", () => {
  it("enters a compound state's initial child only, so reaching a parent does not mark its other children reached", () => {
    expect(paths(descend(node(nestedMachine, "editing")))).toEqual(["", "editing", "editing.draft"]);
    const idle = node(nestedMachine, "idle");
    expect(descend(idle)).toEqual([idle]);
  });

  it("enters every region of a parallel state, so a toggle in the second region is reachable", () => {
    expect(paths(descend(parallelMachine.root))).toEqual(["", "bold", "bold.off", "italic", "italic.off"]);
  });

  it("enters a history state through its parent's initial child, so a resume target still reaches the parent's states", () => {
    expect(paths(enter(node(historyMachine, "on.resume")))).toEqual(["", "on", "on.low", "on.resume"]);
  });

  it("adds every ancestor on enter, so targeting a nested state marks its parent active", () => {
    expect(paths(enter(node(nestedMachine, "editing.review")))).toEqual(["", "editing", "editing.review"]);
  });
});

describe("closure", () => {
  it("follows every edge and enters compound targets, so a full walk reaches nested and final states", () => {
    const start = enter(node(nestedMachine, "idle"));
    expect(paths(closure(start, machineEdges(nestedMachine)))).toEqual(["", "editing", "editing.approved", "editing.draft", "editing.review", "idle"]);
  });

  it("follows only the edges the filter keeps, so a walk that skips an event cannot reach what lies behind it", () => {
    const start = enter(node(soundMachine, "idle"));
    expect(paths(closure(start, machineEdges(soundMachine), (edge) => edge.event !== "LOAD"))).toEqual(["", "closed", "idle"]);
  });
});

describe("statePath and stateNodes", () => {
  it("joins a nested path with dots and leaves out the root, so a finding names editing.draft and never the machine itself", () => {
    expect(stateNodes(nestedMachine).map(statePath)).toEqual(["idle", "editing", "editing.draft", "editing.review", "editing.approved"]);
  });
});
