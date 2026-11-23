import { describe, expect, it } from "vitest";
import { actorName, eventLabel, toMermaid, toMermaidBlock } from "../machine-mermaid";
import { crossLevelMachine, guardedMachine, nestedMachine, parallelMachine, soundMachine } from "./fixtures/machines";

describe("toMermaid", () => {
  it("draws a flat machine with its start, its final state and actor labels, so the printed diagram stays valid Mermaid", () => {
    expect(toMermaid(soundMachine)).toEqual([
      "stateDiagram-v2",
      "  [*] --> idle",
      "  closed --> [*]",
      "  idle --> loading : LOAD",
      "  idle --> closed : CLOSE",
      "  loading --> idle : CANCEL",
      "  loading --> ready : work done",
      "  loading --> failed : work error",
      "  ready --> idle : RESET",
      "  failed --> loading : RETRY",
      "  failed --> closed : CLOSE",
    ]);
  });

  it("draws a compound state as a block with its initial child and labelled ids, so nested keys never clash across parents", () => {
    expect(toMermaid(nestedMachine)).toEqual([
      "stateDiagram-v2",
      "  [*] --> idle",
      "  state editing {",
      "    [*] --> editing_draft",
      '    state "draft" as editing_draft',
      '    state "review" as editing_review',
      '    state "approved" as editing_approved',
      "    editing_approved --> [*]",
      "    editing_draft --> editing_review : NEXT",
      "    editing_review --> editing_draft : BACK",
      "    editing_review --> editing_approved : APPROVE",
      "  }",
      "  idle --> editing : EDIT",
      "  editing --> idle : CANCEL",
      "  editing --> idle : done",
    ]);
  });

  it("lifts a cross-level edge to the common parent's children and keeps a nested self-loop in its parent block, so no edge is lost or drawn inside a leaf", () => {
    expect(toMermaid(crossLevelMachine)).toEqual([
      "stateDiagram-v2",
      "  [*] --> idle",
      "  state editing {",
      "    [*] --> editing_draft",
      '    state "draft" as editing_draft',
      '    state "review" as editing_review',
      "    editing_draft --> editing_draft : TYPE",
      "    editing_draft --> editing_review : NEXT",
      "  }",
      "  idle --> editing : EDIT",
      "  editing --> idle : SUBMIT",
    ]);
  });

  it("splits parallel regions with -- and gives the parallel root no start arrow, so Mermaid draws the regions side by side", () => {
    expect(toMermaid(parallelMachine)).toEqual([
      "stateDiagram-v2",
      "  state bold {",
      "    [*] --> bold_off",
      '    state "off" as bold_off',
      '    state "on" as bold_on',
      "    bold_off --> bold_on : TOGGLE_BOLD",
      "    bold_on --> bold_off : TOGGLE_BOLD",
      "  }",
      "  --",
      "  state italic {",
      "    [*] --> italic_off",
      '    state "off" as italic_off',
      '    state "on" as italic_on',
      "    italic_off --> italic_on : TOGGLE_ITALIC",
      "    italic_on --> italic_off : TOGGLE_ITALIC",
      "  }",
    ]);
  });

  it("appends the guard name to a guarded edge and labels an eventless one always, so a reader sees why two edges share an event", () => {
    expect(toMermaid(guardedMachine)).toEqual(
      expect.arrayContaining(["  idle --> sent : SUBMIT [isValid]", "  idle --> idle : SUBMIT [guard]", "  sent --> idle : always [isValid]"]),
    );
  });
});

describe("eventLabel", () => {
  it.each([
    ["", "always"],
    ["*", "any event"],
    ["xstate.done.actor.fetchUser", "fetchUser done"],
    ["xstate.error.actor.fetchUser", "fetchUser error"],
    ["xstate.snapshot.fetchUser", "fetchUser snapshot"],
    ["xstate.done.state.nested.editing", "done"],
    ["xstate.after.3000.delayed.shown", "after 3000ms"],
    ["xstate.after.debounce.search.typing", "after debounce"],
    ["SUBMIT", "SUBMIT"],
  ])("labels %j as %j, so internal XState event names never reach the diagram", (event, expected) => {
    expect(eventLabel(event)).toBe(expected);
  });

  it("names the actor through the lookup it is given, so a done edge shows the src and not the generated id", () => {
    expect(eventLabel("xstate.done.actor.0.sound.loading", (id) => (id === "0.sound.loading" ? "work" : id))).toBe("work done");
  });
});

describe("actorName", () => {
  it("prefers a string src over the generated invoke id and falls back to the id, so labels read work done and not 0.sound.loading done", () => {
    const loading = soundMachine.getStateNodeById("sound.loading");
    const id = loading.invoke[0]?.id ?? "";
    expect(id).not.toBe("work");
    expect(actorName(loading, id)).toBe("work");
    expect(actorName(loading, "unknown")).toBe("unknown");
  });
});

describe("toMermaidBlock", () => {
  it("fences the diagram as a mermaid code block, so it renders when pasted into a pull request", () => {
    expect(toMermaidBlock(soundMachine)).toEqual(["```mermaid", ...toMermaid(soundMachine), "```"]);
  });
});
