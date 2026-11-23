export const MACHINE_FILE = /\.machine\.tsx?$/;
export const MACHINE_ROOTS = ["app", "workers"] as const;
export const TEST_DIR = "/__tests__/";

export const ALWAYS_EVENT = "";
export const ANY_EVENT = "*";
export const INLINE_GUARD = "guard";
export const SPAWN_CHILD = "xstate.spawnChild";
export const ROOT_STATE = "(root)";

export const EVENT_PREFIX = {
  doneActor: "xstate.done.actor.",
  errorActor: "xstate.error.actor.",
  doneState: "xstate.done.state.",
  after: "xstate.after.",
  snapshot: "xstate.snapshot.",
} as const;

export const EVENT_LABEL = {
  always: "always",
  any: "any event",
  done: "done",
  doneSuffix: " done",
  errorSuffix: " error",
  snapshotSuffix: " snapshot",
  afterPrefix: "after ",
  millis: "ms",
} as const;

export const NUMERIC = /^\d+$/;
export const NOT_MERMAID_ID = /[^A-Za-z0-9_]/g;
export const MERMAID_ID_JOIN = "_";
export const STATE_PATH_JOIN = ".";

export const MERMAID = {
  header: "stateDiagram-v2",
  pseudo: "[*]",
  arrow: " --> ",
  label: " : ",
  indent: "  ",
  concurrent: "--",
  fenceOpen: "```mermaid",
  fenceClose: "```",
} as const;

export const CHECK = {
  unreachable: "machines/unreachable",
  deadEnd: "machines/dead-end",
  startsWork: "machines/starts-work",
  noMachine: "machines/no-machine",
  load: "machines/load",
} as const;

export const MESSAGE = {
  unreachable: "no transition reaches it from the initial state",
  deadEnd: "once entered, no path leads back to the initial state or to a final state, and it is not marked final",
  invokes: "it is active when the machine starts and invokes an actor, so useMachine starts that work during the server render; the actor:",
  spawns:
    "it is active when the machine starts and spawns a child actor on entry, on its initial transition or on an eventless transition, so useMachine starts that work during the server render",
  noMachine: "the file exports no XState machine",
  load: "the file does not load:",
} as const;

export const FIX = {
  unreachable: "add a transition that targets it, or delete the state",
  deadEnd:
    'add a transition out of it (a RESET or CANCEL back to the initial state is the usual one), or mark it `type: "final"` if the machine is meant to stop there',
  startsWork: "start in a state that invokes and spawns nothing, and enter the working state on an event the component sends after mount",
  noMachine: "export the machine (`export const fooMachine = setup({ … }).createMachine({ … })`), or rename the file if it holds no machine",
  load: "run `bun <file>` to see why, and fix the import",
} as const;

export const EXIT = { clean: 0, findings: 1, usage: 2 } as const;

export const CHECK_USAGE = "usage: bun scripts/check-machines.ts [file.machine.ts ...]   check every machine under app/ and workers/, or the files named";
export const DIAGRAM_USAGE = "usage: bun scripts/machine-diagram.ts <file.machine.ts>   print each machine in the file as a Mermaid state diagram";
export const NOTHING_TO_CHECK = "check-machines: no *.machine.ts file found; nothing to check";
