import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { AppLoadContext } from "react-router";
import type { ErrorCapture } from "@/lib/error-reporting/report";
import { BucketRepository } from "@/repositories/bucket";
import { ErrorReporterFrom } from "@/services/error-reporter";
import { RateLimiter } from "@/services/rate-limit";
import { action } from "../upload-file";

type ActionArgs = Parameters<typeof action>[0];

interface DataResult {
  readonly data: unknown;
  readonly init: ResponseInit | null;
}

const upload = async (getSession: () => Promise<unknown>) => {
  const captures: ErrorCapture[] = [];
  const reportError = vi.fn();
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      ErrorReporterFrom({
        capture: (capture) => Effect.sync(() => void captures.push(capture)),
      }),
      Layer.succeed(RateLimiter, { check: () => Effect.void }),
      Layer.succeed(BucketRepository, {
        upload: () => Effect.succeed("uploads/fake"),
      } as unknown as BucketRepository)
    )
  );
  const form = new FormData();
  form.set("file", new File(["hello"], "a.txt", { type: "text/plain" }));
  const result = (await action({
    request: new Request("https://app.example.com/api/upload-file", {
      method: "POST",
      body: form,
    }),
    context: {
      runtime,
      reportError,
      auth: { api: { getSession } },
    } as unknown as AppLoadContext,
    params: {},
  } as unknown as ActionArgs)) as unknown as DataResult;
  await runtime.dispose();
  return { captures, reportError, result };
};

describe("upload-file action, upstream failures", () => {
  it("reports a failed session lookup before it answers 503, so an auth outage is not hidden behind a retry message", async () => {
    const { captures, result } = await upload(() =>
      Promise.reject(new Error("auth backend down"))
    );

    expect(result.init?.status).toBe(503);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      source: "upload",
      error: { _tag: "ExternalServiceError", service: "BetterAuth" },
    });
  });

  it("reports nothing for a bad file, so a user's mistake is not filed as a server error", async () => {
    const { captures, reportError, result } = await upload(async () => ({
      session: { id: "s1" },
      user: { id: "u1", banned: false },
    }));

    expect(result.init?.status).toBe(400);
    expect(captures).toEqual([]);
    expect(reportError).not.toHaveBeenCalled();
  });
});
