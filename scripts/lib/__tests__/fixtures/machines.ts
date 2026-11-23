import { createMachine, fromPromise, setup, spawnChild } from "xstate";

const work = fromPromise(async () => "done");

export const soundMachine = setup({ actors: { work } }).createMachine({
  id: "sound",
  initial: "idle",
  states: {
    idle: { on: { LOAD: "loading", CLOSE: "closed" } },
    loading: {
      invoke: { src: "work", onDone: "ready", onError: "failed" },
      on: { CANCEL: "idle" },
    },
    ready: { on: { RESET: "idle" } },
    failed: { on: { RETRY: "loading", CLOSE: "closed" } },
    closed: { type: "final" },
  },
});

export const unreachableMachine = createMachine({
  id: "unreachable",
  initial: "idle",
  states: {
    idle: { on: { OPEN: "open" } },
    open: { on: { CLOSE: "idle" } },
    orphan: { on: { CLOSE: "idle" } },
  },
});

export const deadEndMachine = createMachine({
  id: "deadEnd",
  initial: "idle",
  states: {
    idle: { on: { SUBMIT: "stuck" } },
    stuck: { on: { RETRY: "stuck" } },
  },
});

export const invokesOnStartMachine = setup({ actors: { work } }).createMachine({
  id: "invokesOnStart",
  initial: "loading",
  states: {
    loading: { invoke: { src: "work", onDone: "ready" } },
    ready: { on: { RELOAD: "loading" } },
  },
});

export const alwaysIntoWorkMachine = setup({ actors: { work } }).createMachine({
  id: "alwaysIntoWork",
  initial: "checking",
  states: {
    checking: { always: "loading" },
    loading: { invoke: { src: "work", onDone: "ready" } },
    ready: { on: { RELOAD: "checking" } },
  },
});

export const spawnsOnStartMachine = setup({
  actors: { work },
  actions: { startWork: spawnChild("work") },
}).createMachine({
  id: "spawnsOnStart",
  initial: "idle",
  states: {
    idle: { entry: "startWork", on: { GO: "done" } },
    done: { on: { RESET: "idle" } },
  },
});

export const nestedMachine = createMachine({
  id: "nested",
  initial: "idle",
  states: {
    idle: { on: { EDIT: "editing" } },
    editing: {
      initial: "draft",
      on: { CANCEL: "idle" },
      onDone: "idle",
      states: {
        draft: { on: { NEXT: "review" } },
        review: { on: { BACK: "draft", APPROVE: "approved" } },
        approved: { type: "final" },
      },
    },
  },
});

export const nestedDeadEndMachine = createMachine({
  id: "nestedDeadEnd",
  initial: "idle",
  states: {
    idle: { on: { EDIT: "editing" } },
    editing: {
      initial: "draft",
      states: {
        draft: { on: { NEXT: "review" } },
        review: { on: { BACK: "draft" } },
      },
    },
  },
});

export const toFinalMachine = createMachine({
  id: "toFinal",
  initial: "idle",
  states: {
    idle: { on: { SUBMIT: "redirecting" } },
    redirecting: { on: { DONE: "gone" } },
    gone: { type: "final" },
  },
});

export const parallelMachine = createMachine({
  id: "parallel",
  type: "parallel",
  states: {
    bold: {
      initial: "off",
      states: { off: { on: { TOGGLE_BOLD: "on" } }, on: { on: { TOGGLE_BOLD: "off" } } },
    },
    italic: {
      initial: "off",
      states: { off: { on: { TOGGLE_ITALIC: "on" } }, on: { on: { TOGGLE_ITALIC: "off" } } },
    },
  },
});

export const guardedMachine = setup({ guards: { isValid: () => true } }).createMachine({
  id: "guarded",
  initial: "idle",
  states: {
    idle: {
      on: {
        SUBMIT: [
          { target: "sent", guard: "isValid" },
          { target: "sent", guard: { type: "isValid" } },
          { target: "idle", guard: () => false },
        ],
      },
    },
    sent: { always: { target: "idle", guard: "isValid" } },
  },
});

export const crossLevelMachine = createMachine({
  id: "crossLevel",
  initial: "idle",
  states: {
    idle: { on: { EDIT: "editing" } },
    editing: {
      initial: "draft",
      states: {
        draft: { on: { TYPE: "draft", NEXT: "review" } },
        review: { on: { SUBMIT: "#crossLevel.idle" } },
      },
    },
  },
});

export const historyMachine = createMachine({
  id: "history",
  initial: "off",
  states: {
    off: { on: { POWER: "on.resume" } },
    on: {
      initial: "low",
      on: { POWER: "off" },
      states: {
        low: { on: { UP: "high" } },
        high: { on: { DOWN: "low" } },
        resume: { type: "history" },
      },
    },
  },
});

export const delayedMachine = createMachine({
  id: "delayed",
  initial: "idle",
  states: {
    idle: { on: { SHOW: "shown" } },
    shown: { after: { 3000: "idle" }, on: { HOVER: { actions: [] } } },
  },
});

export const trappedChildMachine = createMachine({
  id: "trappedChild",
  initial: "idle",
  states: {
    idle: { on: { EDIT: "editing" } },
    editing: {
      initial: "draft",
      onDone: "idle",
      states: {
        draft: { on: { APPROVE: "approved", BREAK: "stuck" } },
        stuck: { on: { POKE: "stuck" } },
        approved: { type: "final" },
      },
    },
  },
});

export const parallelTargetMachine = createMachine({
  id: "parallelTarget",
  initial: "idle",
  states: {
    idle: { on: { START: "active.left.on" } },
    active: {
      type: "parallel",
      on: { STOP: "idle" },
      states: {
        left: { initial: "off", states: { off: { on: { FLIP: "on" } }, on: { on: { FLIP: "off" } } } },
        right: { initial: "off", states: { off: { on: { FLOP: "on" } }, on: { on: { FLOP: "off" } } } },
      },
    },
  },
});

export const alwaysSpawnMachine = setup({ actors: { work } }).createMachine({
  id: "alwaysSpawn",
  initial: "checking",
  states: {
    checking: { always: { target: "ready", actions: spawnChild("work") } },
    ready: { on: { RESET: "checking" } },
  },
});

export const clashingKeysMachine = createMachine({
  id: "clashingKeys",
  initial: "a-b",
  states: {
    "a-b": { on: { NEXT: "a_b" } },
    a_b: { on: { NEXT: "a-b" } },
  },
});
