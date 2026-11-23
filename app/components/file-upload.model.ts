import { Either } from "effect";
import { transition } from "xstate";
import { getShortestPaths } from "xstate/graph";
import { BucketValidationError } from "@/models/errors/bucket";
import { ExternalServiceError } from "@/models/errors/repository";
import { fileUploadMachine, type FileUploadEvent, type UploadResult } from "./file-upload.machine";

type UploadDoneEvent = { readonly type: "xstate.done.actor.upload"; readonly output: UploadResult };

export type ModelEvent = FileUploadEvent | UploadDoneEvent;

const UPLOAD_OK: UploadResult = Either.right({ key: "uploads/model-test.txt" });
const UPLOAD_REFUSED: UploadResult = Either.left(
  new BucketValidationError({
    message: "File content does not match its declared type",
    field: "file",
  }),
);
const UPLOAD_UNREACHABLE: UploadResult = Either.left(
  new ExternalServiceError({ service: "upload-file", cause: "connection dropped" }),
);

type FileUploadSnapshot = ReturnType<typeof fileUploadMachine.transition>;

export const fileUploadTraversal = (opts: {
  readonly maxSize: number;
  readonly small: File;
  readonly big: File;
}) => ({
  input: { maxSize: opts.maxSize },
  events: [
    { type: "DRAG_ENTER" },
    { type: "DRAG_LEAVE" },
    { type: "PICK", file: opts.small },
    { type: "PICK", file: opts.big },
    { type: "RESET" },
    { type: "xstate.done.actor.upload", output: UPLOAD_OK },
    { type: "xstate.done.actor.upload", output: UPLOAD_REFUSED },
    { type: "xstate.done.actor.upload", output: UPLOAD_UNREACHABLE },
  ] as unknown as FileUploadEvent[],
  serializeEvent: (e: FileUploadEvent) =>
    e.type === "PICK" ? `PICK:${e.file.name}:${e.file.size}` : JSON.stringify(e),
});

export const fileUploadPaths = (
  opts: Parameters<typeof fileUploadTraversal>[0],
  extra: { fromState?: FileUploadSnapshot; toState?: (s: FileUploadSnapshot) => boolean } = {},
) => getShortestPaths(fileUploadMachine, { ...fileUploadTraversal(opts), ...extra });

export const fileUploadEdgePaths = (opts: Parameters<typeof fileUploadTraversal>[0]) => {
  const { events } = fileUploadTraversal(opts);
  return fileUploadPaths(opts).flatMap((path) =>
    events
      .filter((event) => path.state.can(event))
      .map((event) => {
        const [next] = transition(fileUploadMachine, path.state, event);
        return { state: next, steps: [...path.steps, { event, state: next }] };
      }),
  );
};

export const describePath = (
  steps: ReadonlyArray<{ readonly event: ModelEvent }>,
  end: string,
): string => {
  const label = (e: ModelEvent) =>
    e.type === "PICK"
      ? `PICK ${e.file.name}`
      : e.type === "xstate.done.actor.upload"
        ? `upload ${Either.match(e.output, {
            onRight: () => "ok",
            onLeft: (err) => (err._tag === "ExternalServiceError" ? "unreachable" : "refused"),
          })}`
        : e.type;
  const events = steps
    .map((s) => s.event)
    .filter((e) => (e as { type: string }).type !== "xstate.init");
  return [...events.map(label), end].join(" → ");
};
