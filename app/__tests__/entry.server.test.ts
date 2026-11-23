import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { AppLoadContext, HandleErrorFunction } from "react-router";
import { handleError, reportRenderError } from "../entry.server";
import type { ErrorReport } from "@/lib/error-reporting/adapter";
import type { ErrorCapture } from "@/lib/error-reporting/report";
import { makeErrorReporter, reportError as reportErrorWith } from "@/services/error-reporter";

type HandleErrorArgs = Parameters<HandleErrorFunction>[1];

const argsFor = (request: Request) => {
  const reportError = vi.fn();
  const args = {
    request,
    params: {},
    context: { reportError } as unknown as AppLoadContext,
  } as unknown as HandleErrorArgs;
  return { reportError, args };
};

const abortedRequest = () => {
  const controller = new AbortController();
  controller.abort();
  return new Request("https://app.example.com/dashboard", {
    signal: controller.signal,
  });
};

describe("handleError", () => {
  it("reports a GET as a loader error and a POST as an action error, so the report says which half failed", () => {
    const error = new Error("boom");
    const get = argsFor(new Request("https://app.example.com/dashboard"));
    const post = argsFor(new Request("https://app.example.com/dashboard", { method: "POST" }));

    handleError(error, get.args);
    handleError(error, post.args);

    expect(get.reportError).toHaveBeenCalledWith({ error, source: "loader" });
    expect(post.reportError).toHaveBeenCalledWith({ error, source: "action" });
  });

  it("reports nothing for an aborted request, so a user leaving the page is not an error", () => {
    const { reportError, args } = argsFor(abortedRequest());

    handleError(new Error("aborted"), args);

    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("reportRenderError", () => {
  it("reports every render error as a render error, so one caught by a Suspense boundary before the shell is not lost", () => {
    const reportError = vi.fn();
    const error = new Error("suspended child failed");

    reportRenderError({ reportError }, error);

    expect(reportError).toHaveBeenCalledWith({ error, source: "render" });
  });

  it("is counted once when the same error also reaches handleError, so a failed shell is not reported twice", async () => {
    const reports: ErrorReport[] = [];
    const deliveries: Array<Promise<void>> = [];
    const reporter = makeErrorReporter({
      adapter: { name: "rec", send: (batch) => Effect.sync(() => void reports.push(...batch)) },
      release: "v1",
      environment: "test",
      waitUntil: (delivery) => void deliveries.push(delivery),
    });
    const reportError = (capture: ErrorCapture) => reportErrorWith(reporter, capture);
    const error = new Error("shell failed");
    const { args } = argsFor(new Request("https://app.example.com/dashboard"));

    reportRenderError({ reportError }, error);
    handleError(error, { ...args, context: { reportError } as unknown as AppLoadContext });
    await Promise.all(deliveries);

    expect(reports.map((report) => report.source)).toEqual(["render"]);
  });
});
