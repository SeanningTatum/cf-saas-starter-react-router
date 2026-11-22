import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeRequestContext } from "../request-context";

const APP = resolve(__dirname, "../..");

const AUTH_DIR = join(APP, "auth");

const ACCESS_DECIDING_FILES = [
  ...readdirSync(AUTH_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(AUTH_DIR, name)),
  join(APP, "lib/session.ts"),
  join(APP, "services/session.ts"),
  join(APP, "services/rate-limit.ts"),
  join(APP, "trpc/index.ts"),
  join(APP, "routes/api/auth.$.ts"),
  join(APP, "routes/api/upload-file.ts"),
];

const READS_REQUEST_ID = /\brequestId\b|\bCurrentRequest\b|\bcurrentRequestContext\b|x-request-id/;

describe("the request id is for finding logs, never for deciding access", () => {
  it("is whatever trace id the caller sends in traceparent, so a caller can pick it", () => {
    const chosen = "0123456789abcdef0123456789abcdef";
    const request = new Request("https://app.test/dashboard", {
      headers: { traceparent: `00-${chosen}-0123456789abcdef-01` },
    });
    expect(makeRequestContext(request).requestId).toBe(chosen);
  });

  it.each(ACCESS_DECIDING_FILES.map((file) => [file.slice(APP.length + 1), file]))(
    "%s does not read the request id, so a chosen id cannot grant or refuse access",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).not.toMatch(READS_REQUEST_ID);
    }
  );
});
