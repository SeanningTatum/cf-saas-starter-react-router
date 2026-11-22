import { describe, expect, it, vi } from "vitest";
import { Cause, Exit, Layer, ManagedRuntime, Option } from "effect";
import { data, type AppLoadContext } from "react-router";
import { action } from "../upload-file";
import { BucketRepository } from "@/repositories/bucket";
import { Bucket } from "@/services/bucket";
import { makeOtlpTracer, makeSpanBuffer } from "@/services/tracing";
import {
  AUTH_GET_SESSION_SPAN,
  R2_PUT_SPAN,
  UPLOAD_READ_HEAD_SPAN,
  UPLOAD_STORE_FILE_SPAN,
} from "@/lib/constants/spans";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type ActionArgs = Parameters<typeof action>[0];

interface DataResult {
  readonly data: unknown;
  readonly init: ResponseInit | null;
}

const runUpload = async (exit: Exit.Exit<unknown, unknown>) => {
  const reportError = vi.fn();
  const form = new FormData();
  form.set("file", new File(["hello"], "a.txt", { type: "text/plain" }));
  const context = {
    runtime: { runPromiseExit: () => Promise.resolve(exit) },
    reportError,
  } as unknown as AppLoadContext;
  const result = (await action({
    request: new Request("https://app.example.com/api/upload-file", {
      method: "POST",
      body: form,
    }),
    context,
    params: {},
  } as unknown as ActionArgs)) as unknown as DataResult;
  return { reportError, result };
};

describe("upload-file action", () => {
  it("answers 500 and reports the cause with source upload when the program dies, so a crashed upload is seen", async () => {
    const boom = new Error("boom");

    const { reportError, result } = await runUpload(Exit.die(boom));

    expect(result.init?.status).toBe(500);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [capture] = reportError.mock.calls[0] ?? [];
    expect(capture.source).toBe("upload");
    expect(Cause.isCause(capture.error)).toBe(true);
    expect(Cause.squash(capture.error)).toBe(boom);
  });

  it("reports nothing when the program answers, so a 401 or 400 is not filed as a server error", async () => {
    const { reportError, result } = await runUpload(
      Exit.succeed(data({ success: false, error: "Unauthorized" }, { status: 401 }))
    );

    expect(result.init?.status).toBe(401);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("upload-file action spans", () => {
  it("runs the upload under one upload.store_file span with the session lookup, the head read and the put inside it, so a slow upload shows where its time went", async () => {
    const buffer = makeSpanBuffer();
    const bucket = Layer.succeed(Bucket, {
      bucket: { put: async () => {} } as unknown as R2Bucket,
    });
    const runtime = ManagedRuntime.make(
      Layer.merge(
        Layer.setTracer(makeOtlpTracer(buffer)),
        BucketRepository.Default.pipe(Layer.provide(bucket))
      )
    );
    const form = new FormData();
    form.set("file", new File([PNG_SIGNATURE], "a.png", { type: "image/png" }));
    const context = {
      auth: {
        api: { getSession: async () => ({ user: { id: "u1" }, session: {} }) },
      },
      runtime,
      reportError: vi.fn(),
    } as unknown as AppLoadContext;

    const result = (await action({
      request: new Request("https://app.example.com/api/upload-file", {
        method: "POST",
        body: form,
      }),
      context,
      params: {},
    } as unknown as ActionArgs)) as unknown as DataResult;
    await runtime.dispose();

    expect(result.data).toMatchObject({ success: true });
    const root = buffer.spans.find((span) => span.name === UPLOAD_STORE_FILE_SPAN);
    const parentOf = (name: string) =>
      Option.getOrUndefined(
        buffer.spans.find((span) => span.name === name)?.parent ?? Option.none()
      )?.spanId;
    expect(root).toBeDefined();
    expect(parentOf(AUTH_GET_SESSION_SPAN)).toBe(root?.spanId);
    expect(parentOf(UPLOAD_READ_HEAD_SPAN)).toBe(root?.spanId);
    expect(parentOf(R2_PUT_SPAN)).toBe(root?.spanId);
  });
});
