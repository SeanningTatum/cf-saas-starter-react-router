import { afterEach, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Layer, Logger, ManagedRuntime } from "effect";
import { data, type AppLoadContext } from "react-router";
import { action } from "../upload-file";
import { trackedUpload } from "./tracked-upload";
import { RateLimiter, type RateLimitRule } from "@/services/rate-limit";
import { ErrorReporterFrom } from "@/services/error-reporter";
import { RateLimitError } from "@/models/errors/rate-limit";
import type { ErrorCapture } from "@/lib/error-reporting/report";
import {
  HTTP_TOO_MANY_REQUESTS,
  RATE_LIMIT_PERIOD_SECONDS,
  RETRY_AFTER_HEADER,
  UPLOAD_RATE_LIMITED_MESSAGE,
} from "@/lib/constants/rate-limit";
import {
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_UNAUTHORIZED,
  MAX_UPLOAD_REQUEST_BYTES,
  UPLOAD_NO_FILE_MESSAGE,
  UPLOAD_NOT_A_FORM_MESSAGE,
  UPLOAD_TOO_LARGE_MESSAGE,
  UPLOAD_UNAUTHORIZED_MESSAGE,
} from "@/lib/constants/upload";

type ActionArgs = Parameters<typeof action>[0];

interface UploadResult {
  readonly data: { readonly success: boolean; readonly error?: string };
  readonly init: ResponseInit | null;
}

interface LoggedLine {
  readonly level: string;
  readonly message: unknown;
}

const URL_UNDER_TEST = "https://app.example.com/api/upload-file";
const USER_ID = "user-upload-test";

const runtimes: Array<ManagedRuntime.ManagedRuntime<RateLimiter, never>> = [];

const harness = ({ signedIn, allow }: { readonly signedIn: boolean; readonly allow: boolean }) => {
  const asked: Array<[RateLimitRule, string]> = [];
  const captures: ErrorCapture[] = [];
  const logged: LoggedLine[] = [];
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(RateLimiter, {
        check: (rule, key) => {
          asked.push([rule, key]);
          return allow
            ? Effect.void
            : Effect.fail(new RateLimitError({ rule, retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS }));
        },
      }),
      ErrorReporterFrom({ capture: (capture) => Effect.sync(() => void captures.push(capture)) }),
      Logger.replace(
        Logger.defaultLogger,
        Logger.make(({ logLevel, message }) => void logged.push({ level: logLevel.label, message }))
      )
    )
  );
  runtimes.push(runtime);
  const session = signedIn ? { user: { id: USER_ID, banned: false, banExpires: null } } : null;
  const reportError = vi.fn();
  const context = {
    runtime,
    reportError,
    auth: { api: { getSession: vi.fn(async () => session) } },
  } as unknown as AppLoadContext;
  return { context, asked, captures, logged, reportError };
};

const upload = async (request: Request, context: AppLoadContext) =>
  (await action({ request, context, params: {} } as unknown as ActionArgs)) as unknown as UploadResult;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

describe("upload-file action, checks before the body is read", () => {
  it("answers a signed-out caller 401 without reading the body or counting against any user", async () => {
    const { context, asked } = harness({ signedIn: false, allow: true });
    const { request, bodyRead } = await trackedUpload(URL_UNDER_TEST);

    const result = await upload(request, context);

    expect(result.init?.status).toBe(HTTP_UNAUTHORIZED);
    expect(result.data).toEqual({ success: false, error: UPLOAD_UNAUTHORIZED_MESSAGE });
    expect(asked).toEqual([]);
    expect(bodyRead()).toBe(false);
  });

  it("answers an over-limit caller 429 with Retry-After and the route's own body, without reading the body", async () => {
    const { context } = harness({ signedIn: true, allow: false });
    const { request, bodyRead } = await trackedUpload(URL_UNDER_TEST);

    const result = await upload(request, context);

    expect(result.init?.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(new Headers(result.init?.headers).get(RETRY_AFTER_HEADER)).toBe(String(RATE_LIMIT_PERIOD_SECONDS));
    expect(result.data).toEqual({ success: false, error: UPLOAD_RATE_LIMITED_MESSAGE });
    expect(bodyRead()).toBe(false);
  });

  it("neither logs nor reports a rate-limited upload as an error, since a refused caller is expected", async () => {
    const { context, captures, logged, reportError } = harness({ signedIn: true, allow: false });
    const { request } = await trackedUpload(URL_UNDER_TEST);

    await upload(request, context);

    expect(logged.filter(({ level }) => level === "ERROR" || level === "FATAL")).toEqual([]);
    expect(captures).toEqual([]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("refuses a declared length past the upload cap with 413 before reading the body", async () => {
    const { context } = harness({ signedIn: true, allow: true });
    const { request, bodyRead } = await trackedUpload(URL_UNDER_TEST, {
      contentLength: MAX_UPLOAD_REQUEST_BYTES + 1,
    });

    const result = await upload(request, context);

    expect(result.init?.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
    expect(result.data).toEqual({ success: false, error: UPLOAD_TOO_LARGE_MESSAGE });
    expect(bodyRead()).toBe(false);
  });

  it("checks the upload rule against the signed-in user's id, then reads the body", async () => {
    const { context, asked } = harness({ signedIn: true, allow: true });
    const { request, bodyRead } = await trackedUpload(URL_UNDER_TEST);

    const result = await upload(request, context);

    expect(asked).toEqual([["upload", USER_ID]]);
    expect(bodyRead()).toBe(true);
    expect(result.init?.status).toBe(HTTP_BAD_REQUEST);
    expect(result.data).toEqual({ success: false, error: UPLOAD_NO_FILE_MESSAGE });
  });

  it("answers 400 for a body that is not a form, so a malformed post is not a 500", async () => {
    const { context, reportError } = harness({ signedIn: true, allow: true });
    const request = new Request(URL_UNDER_TEST, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const result = await upload(request, context);

    expect(result.init?.status).toBe(HTTP_BAD_REQUEST);
    expect(result.data).toEqual({ success: false, error: UPLOAD_NOT_A_FORM_MESSAGE });
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("upload-file action, error reporting", () => {
  const runWithExit = async (exit: Exit.Exit<unknown, unknown>) => {
    const reportError = vi.fn();
    const context = {
      runtime: { runPromiseExit: () => Promise.resolve(exit) },
      reportError,
    } as unknown as AppLoadContext;
    const { request } = await trackedUpload(URL_UNDER_TEST);
    return { reportError, result: await upload(request, context) };
  };

  it("answers 500 and reports the cause with source upload when the program dies, so a crashed upload is seen", async () => {
    const boom = new Error("boom");

    const { reportError, result } = await runWithExit(Exit.die(boom));

    expect(result.init?.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [capture] = reportError.mock.calls[0] ?? [];
    expect(capture.source).toBe("upload");
    expect(Cause.isCause(capture.error)).toBe(true);
    expect(Cause.squash(capture.error)).toBe(boom);
  });

  it("reports nothing when the program answers, so a 401 or 400 is not filed as a server error", async () => {
    const { reportError, result } = await runWithExit(
      Exit.succeed(data({ success: false, error: UPLOAD_UNAUTHORIZED_MESSAGE }, { status: HTTP_UNAUTHORIZED }))
    );

    expect(result.init?.status).toBe(HTTP_UNAUTHORIZED);
    expect(reportError).not.toHaveBeenCalled();
  });
});
