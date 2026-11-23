import { Effect, Either } from "effect";
import { assign, emit, fromPromise, setup } from "xstate";
import { uploadFile, type UploadClientError } from "@/lib/upload-client";
import { ExternalServiceError } from "@/models/errors/repository";
import { UPLOAD_FAILURE_TOO_BIG, UPLOAD_FAILURE_UNREACHABLE } from "@/lib/constants/upload";

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

export const fileUploadMachine = setup({
  types: {} as {
    context: FileUploadContext;
    events: FileUploadEvent;
    emitted: FileUploadEmitted;
    input: { readonly maxSize: number };
  },
  actors: {
    upload: fromPromise<UploadResult, { readonly file: File | null }>(({ input, signal }) =>
      Effect.runPromise(
        Effect.either(
          input.file
            ? uploadFile(input.file)
            : Effect.fail(new ExternalServiceError({ service: "upload-file", cause: "no file" })),
        ),
        { signal },
      ),
    ),
  },
  guards: {
    fits: ({ context, event }) => event.type === "PICK" && event.file.size <= context.maxSize,
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
      error: UPLOAD_FAILURE_TOO_BIG,
    })),
    emitUploaded: emit(({ context }) => ({ type: "uploaded" as const, key: context.key ?? "" })),
    emitFailed: emit(({ context }) => ({
      type: "failed" as const,
      error: context.error ?? UPLOAD_FAILURE_UNREACHABLE,
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
                  Either.match(event.output, {
                    onLeft: toFailure,
                    onRight: () => UPLOAD_FAILURE_UNREACHABLE,
                  }),
              }),
              "emitFailed",
            ],
          },
        ],
        onError: {
          target: "failed",
          actions: [assign({ error: UPLOAD_FAILURE_UNREACHABLE }), "emitFailed"],
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
