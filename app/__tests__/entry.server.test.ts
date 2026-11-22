import { describe, expect, it, vi } from "vitest";
import type { AppLoadContext, HandleErrorFunction } from "react-router";
import { handleError, reportRenderError } from "../entry.server";

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
    const post = argsFor(
      new Request("https://app.example.com/dashboard", { method: "POST" })
    );

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
  it("reports a stream error after the shell as a render error, so a broken Suspense boundary is seen", () => {
    const reportError = vi.fn();
    const error = new Error("late render");

    reportRenderError({ reportError }, true, error);

    expect(reportError).toHaveBeenCalledWith({ error, source: "render" });
  });

  it("reports nothing before the shell, so the error handleError already got is not counted twice", () => {
    const reportError = vi.fn();

    reportRenderError({ reportError }, false, new Error("shell failed"));

    expect(reportError).not.toHaveBeenCalled();
  });
});
