import { Either } from "effect";
import { transition } from "xstate";
import { getShortestPaths } from "xstate/graph";
import { BucketValidationError } from "@/models/errors/bucket";
import {
  fileUploadMachine,
  type FileUploadEvent,
  type UploadResult,
} from "./file-upload.machine";

/**
 * Test support for fileUploadMachine: event paths through its graph. The unit
 * test checks them; the e2e spec replays them in the browser. Not imported by
 * app code.
 *
 * xstate/graph's createTestModel rejects machines that invoke actors, so this
 * walks the graph with getShortestPaths and callers replay the steps.
 */

/** The event xstate sends when the invoked `upload` actor resolves. */
export type UploadDoneEvent = { readonly type: "xstate.done.actor.upload"; readonly output: UploadResult };

export type ModelEvent = FileUploadEvent | UploadDoneEvent;

export const UPLOAD_OK: UploadResult = Either.right({ key: "uploads/model-test.txt" });
export const UPLOAD_REFUSED: UploadResult = Either.left(
  new BucketValidationError({ message: "File content does not match its declared type", field: "file" })
);

type FileUploadSnapshot = ReturnType<typeof fileUploadMachine.transition>;

/** Traversal options shared by every walk of the machine's graph. */
export const fileUploadTraversal = (opts: {
  readonly maxSize: number;
  readonly small: File;
  readonly big: File;
}) => ({
  input: { maxSize: opts.maxSize },
  // Done events are not in the machine's event type; the traversal needs them
  // to leave `uploading`, so they are cast in here.
  events: [
    { type: "DRAG_ENTER" },
    { type: "DRAG_LEAVE" },
    { type: "PICK", file: opts.small },
    { type: "PICK", file: opts.big },
    { type: "RESET" },
    { type: "xstate.done.actor.upload", output: UPLOAD_OK },
    { type: "xstate.done.actor.upload", output: UPLOAD_REFUSED },
  ] as unknown as FileUploadEvent[],
  // The default key is JSON.stringify, and a File stringifies to {}, which
  // makes every PICK the same edge. Key a pick by the file's name and size.
  serializeEvent: (e: FileUploadEvent) =>
    e.type === "PICK" ? `PICK:${e.file.name}:${e.file.size}` : JSON.stringify(e),
});

export const fileUploadPaths = (
  opts: Parameters<typeof fileUploadTraversal>[0],
  extra: { fromState?: FileUploadSnapshot; toState?: (s: FileUploadSnapshot) => boolean } = {}
) => getShortestPaths(fileUploadMachine, { ...fileUploadTraversal(opts), ...extra });

/**
 * One path per transition: the shortest path to each distinct state, plus one
 * more event for every event that state accepts. Shortest paths alone stop at
 * the first way into each state, so an edge into an already-reached state
 * (success → RESET → idle, the old reset bug) would never be replayed.
 */
export const fileUploadEdgePaths = (opts: Parameters<typeof fileUploadTraversal>[0]) => {
  const { events } = fileUploadTraversal(opts);
  return fileUploadPaths(opts).flatMap((path) =>
    events
      .filter((event) => path.state.can(event))
      .map((event) => {
        const [next] = transition(fileUploadMachine, path.state, event);
        return { state: next, steps: [...path.steps, { event, state: next }] };
      })
  );
};

/** A human label for a path, e.g. "PICK small.txt → done(ok) → success". */
export const describePath = (
  steps: ReadonlyArray<{ readonly event: ModelEvent }>,
  end: string
): string => {
  const label = (e: ModelEvent) =>
    e.type === "PICK"
      ? `PICK ${e.file.name}`
      : e.type === "xstate.done.actor.upload"
        ? `upload ${Either.isRight(e.output) ? "ok" : "refused"}`
        : e.type;
  const events = steps
    .map((s) => s.event)
    .filter((e) => (e as { type: string }).type !== "xstate.init");
  return [...events.map(label), end].join(" → ");
};
