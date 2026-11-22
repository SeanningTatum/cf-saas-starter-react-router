import { describe, expect, it, vi } from "vitest";
import { Cause, Exit } from "effect";
import { data, type AppLoadContext } from "react-router";
import { action } from "../upload-file";

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
