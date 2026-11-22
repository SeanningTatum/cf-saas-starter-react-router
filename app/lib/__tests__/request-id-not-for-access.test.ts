import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeRequestContext } from "../request-context";

const APP = resolve(__dirname, "../..");

const READS_REQUEST_ID = /\brequestId\b|\bCurrentRequest\b|\bcurrentRequestContext\b|x-request-id/;

const LOGGING_AND_TRACING_FILES = new Set([
  "entry.server.tsx",
  "root.tsx",
  "runtime.ts",
  "lib/log-format.ts",
  "lib/request-context.ts",
  "lib/request-id.ts",
  "lib/error-reporting/adapter.ts",
  "lib/error-reporting/adapters/sentry.ts",
  "lib/error-reporting/browser-payload.ts",
  "lib/error-reporting/browser-report.ts",
  "lib/error-reporting/browser.ts",
  "lib/error-reporting/report.ts",
  "services/error-reporter.ts",
  "services/logger.ts",
  "services/tracing.ts",
]);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

const appSources = sourceFiles(APP).map((path) => relative(APP, path));

describe("the request id is for finding logs, never for deciding access", () => {
  it("is whatever trace id the caller sends in traceparent, so a caller can pick it", () => {
    const chosen = "0123456789abcdef0123456789abcdef";
    const request = new Request("https://app.test/dashboard", {
      headers: { traceparent: `00-${chosen}-0123456789abcdef-01` },
    });
    expect(makeRequestContext(request).requestId).toBe(chosen);
  });

  it("is read only by the logging, tracing and error-reporting files, so no access check can depend on a chosen id", () => {
    const readers = appSources.filter((file) => READS_REQUEST_ID.test(readFileSync(join(APP, file), "utf8")));
    expect(readers.filter((file) => !LOGGING_AND_TRACING_FILES.has(file))).toEqual([]);
  });

  it("is not read by the auth, session, rate-limit, tRPC context or upload code", () => {
    for (const file of LOGGING_AND_TRACING_FILES) {
      expect(file).not.toMatch(/^(auth\/|lib\/session|services\/(session|rate-limit)|trpc\/|routes\/)/);
    }
  });
});
