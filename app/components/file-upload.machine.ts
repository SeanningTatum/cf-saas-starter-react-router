import { Effect, Either } from "effect";
import { assign, emit, fromPromise, setup } from "xstate";
import { uploadFile, type UploadClientError } from "@/lib/upload-client";
import { ExternalServiceError } from "@/models/errors/repository";

/**
 * The FileUpload component's behaviour, and its spec.
 *
 *   idle ──DRAG_ENTER──▶ dragging ──DRAG_LEAVE──▶ idle
 *   idle | dragging | failed ──PICK [fits]──▶ uploading ──done──▶ success | failed
 *   idle | dragging | failed ──PICK [too big]──▶ failed
 *   success | failed ──RESET──▶ idle (clears file, key and error)
 *
 * The component renders from `state.value` and puts it on `data-state`.
 * Unit tests drive this file directly; the e2e paths are generated from it.
 */

export type UploadFailure =
  | { readonly reason: "too_big" }
  | { readonly reason: "rejected"; readonly message: string }
  | { readonly reason: "unreachable" };

export type UploadResult = Either.Either<{ readonly key: string }, UploadClientError>;

export type FileUploadEvent =
  | { readonly type: "DRAG_ENTER" }
  | { readonly type: "DRAG_LEAVE" }
  | { readonly type: "PICK"; readonly file: File }
  | { readonly type: "RESET" };

export type FileUploadEmitted =
  | { readonly type: "uploaded"; readonly key: string }
  | { readonly type: "failed"; readonly error: UploadFailure };

export interface FileUploadContext {
  readonly maxSize: number;
  readonly file: File | null;
  readonly key: string | null;
  readonly error: UploadFailure | null;
}

const toFailure = (e: UploadClientError): UploadFailure =>
  e._tag === "BucketValidationError"
    ? { reason: "rejected", message: e.message }
    : { reason: "unreachable" };

const TOO_BIG: UploadFailure = { reason: "too_big" };
const UNREACHABLE: UploadFailure = { reason: "unreachable" };

export const fileUploadMachine = setup({
  types: {} as {
    context: FileUploadContext;
    events: FileUploadEvent;
    emitted: FileUploadEmitted;
    input: { readonly maxSize: number };
  },
  actors: {
    // Effect.either keeps tagged errors as data: the promise only rejects if the
    // actor is stopped mid-flight (signal aborted), and onError covers that.
    // keepFile always sets a file before `uploading`; the null branch only keeps
    // the types honest instead of casting.
    upload: fromPromise<UploadResult, { readonly file: File | null }>(({ input, signal }) =>
      Effect.runPromise(
        Effect.either(
          input.file
            ? uploadFile(input.file)
            : Effect.fail(new ExternalServiceError({ service: "upload-file", cause: "no file" }))
        ),
        { signal }
      )
    ),
  },
  guards: {
    fits: ({ context, event }) =>
      event.type === "PICK" && event.file.size <= context.maxSize,
  },
  actions: {
    keepFile: assign(({ event }) => ({
      file: event.type === "PICK" ? event.file : null,
      key: null,
      error: null,
    })),
    rejectTooBig: assign(({ event }) => ({
      file: event.type === "PICK" ? event.file : null,
      key: null,
      error: TOO_BIG,
    })),
    // Emits read context, which the assign before them has already updated.
    emitUploaded: emit(({ context }) => ({ type: "uploaded" as const, key: context.key ?? "" })),
    emitFailed: emit(({ context }) => ({
      type: "failed" as const,
      error: context.error ?? UNREACHABLE,
    })),
    clearError: assign({ error: null }),
    clear: assign({ file: null, key: null, error: null }),
  },
}).createMachine({
  id: "fileUpload",
  initial: "idle",
  context: ({ input }) => ({
    maxSize: input.maxSize,
    file: null,
    key: null,
    error: null,
  }),
  states: {
    idle: {
      on: {
        DRAG_ENTER: "dragging",
        PICK: [
          { guard: "fits", target: "uploading", actions: "keepFile" },
          { target: "failed", actions: ["rejectTooBig", "emitFailed"] },
        ],
      },
    },
    dragging: {
      on: {
        DRAG_LEAVE: "idle",
        PICK: [
          { guard: "fits", target: "uploading", actions: "keepFile" },
          { target: "failed", actions: ["rejectTooBig", "emitFailed"] },
        ],
      },
    },
    uploading: {
      invoke: {
        id: "upload",
        src: "upload",
        input: ({ context }) => ({ file: context.file }),
        onDone: [
          {
            guard: ({ event }) => Either.isRight(event.output),
            target: "success",
            actions: [
              assign({ key: ({ event }) => Either.getOrNull(event.output)?.key ?? null }),
              "emitUploaded",
            ],
          },
          {
            target: "failed",
            actions: [
              assign({
                error: ({ event }) =>
                  Either.match(event.output, { onLeft: toFailure, onRight: () => UNREACHABLE }),
              }),
              "emitFailed",
            ],
          },
        ],
        onError: {
          target: "failed",
          actions: [assign({ error: UNREACHABLE }), "emitFailed"],
        },
      },
    },
    success: {
      on: { RESET: { target: "idle", actions: "clear" } },
    },
    failed: {
      on: {
        RESET: { target: "idle", actions: "clear" },
        DRAG_ENTER: { target: "dragging", actions: "clearError" },
        PICK: [
          { guard: "fits", target: "uploading", actions: "keepFile" },
          { target: "failed", actions: ["rejectTooBig", "emitFailed"], reenter: true },
        ],
      },
    },
  },
});

export type FileUploadState = "idle" | "dragging" | "uploading" | "success" | "failed";
