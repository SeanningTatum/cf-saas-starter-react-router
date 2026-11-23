import { describe, expect, it } from "vitest";
import { buildReport, withoutQuery, type ReportStamp } from "../report";
import { MAX_ERROR_MESSAGE_LENGTH, MAX_ERROR_STACK_LENGTH } from "@/lib/constants/error-reporting";
import { REDACTED } from "@/lib/constants/redaction";
import { hashEmail } from "@/lib/redact";

const fullStamp = (): ReportStamp => ({
  id: "report-1",
  timestamp: "2026-01-02T03:04:05.000Z",
  release: "v1.2.3",
  environment: "staging",
  requestId: "req-server",
  userId: "u1",
  method: "POST",
  path: "/dashboard",
});

const bareStamp = (): ReportStamp => ({
  id: "report-2",
  timestamp: "2026-01-02T03:04:05.000Z",
  release: "v1",
  environment: "production",
});

describe("buildReport", () => {
  it("stamps id, time, release, environment, request, user, method and path, so a report can be traced to its request", () => {
    expect(buildReport({ error: new Error("boom"), source: "loader" }, fullStamp())).toMatchObject({
      id: "report-1",
      timestamp: "2026-01-02T03:04:05.000Z",
      release: "v1.2.3",
      environment: "staging",
      requestId: "req-server",
      userId: "u1",
      method: "POST",
      path: "/dashboard",
      source: "loader",
    });
  });

  it("keeps the capture's own request id over the stamp's, so a browser report names the page's request", () => {
    const report = buildReport(
      { error: new Error("boom"), source: "window", requestId: "req-page" },
      fullStamp(),
    );

    expect(report.requestId).toBe("req-page");
  });

  it("lets a capture set its level, so a caller can lower a known-noisy error to a warning", () => {
    const report = buildReport(
      { error: new Error("boom"), source: "window", level: "warning" },
      bareStamp(),
    );

    expect(report.level).toBe("warning");
  });

  it("clips message and stack to the caps, so one huge error cannot blow the report size", () => {
    const error = new Error("m".repeat(MAX_ERROR_MESSAGE_LENGTH + 50));
    error.stack = "s".repeat(MAX_ERROR_STACK_LENGTH + 50);

    const report = buildReport({ error, source: "fetch" }, bareStamp());

    expect(report.message).toHaveLength(MAX_ERROR_MESSAGE_LENGTH);
    expect(report.stack).toHaveLength(MAX_ERROR_STACK_LENGTH);
  });

  it("hashes an email in the message and masks a bearer token in the stack, so a raw payload cannot reach an adapter", () => {
    const error = new Error("no account for user@example.com");
    error.stack = "Error: failed\n  header Bearer abc.def-123";

    const report = buildReport({ error, source: "action" }, bareStamp());

    expect(report.message).toBe(`no account for ${hashEmail("user@example.com")}`);
    expect(report.stack).toContain(`Bearer ${REDACTED}`);
    expect(report.stack).not.toContain("abc.def-123");
  });

  it("leaves absent fields out as keys, so no adapter sees an undefined value", () => {
    const report = buildReport({ error: "plain", source: "fetch" }, bareStamp());

    for (const key of ["stack", "tag", "requestId", "userId", "method", "path", "url"]) {
      expect(report).not.toHaveProperty(key);
    }
    expect(Object.values(report)).not.toContain(undefined);
  });

  it("drops the query from a capture's url, so tokens in a page url are not reported", () => {
    const report = buildReport(
      {
        error: new Error("boom"),
        source: "window",
        url: "https://app.example.com/reset?token=abc#top",
      },
      bareStamp(),
    );

    expect(report.url).toBe("https://app.example.com/reset");
  });
});

describe("withoutQuery", () => {
  it("drops query and hash, and gives undefined for a non-URL, so junk is not stored as a url", () => {
    expect(withoutQuery("https://app.example.com/a/b?x=1#h")).toBe("https://app.example.com/a/b");
    expect(withoutQuery("not a url")).toBeUndefined();
  });
});

describe("buildReport, redaction of every text field", () => {
  it("hashes an email in the error name, so a browser cannot put an address in the one field left raw", () => {
    const report = buildReport(
      { error: { name: "user@example.com", message: "x" }, source: "window" },
      bareStamp(),
    );

    expect(report.name).toBe(hashEmail("user@example.com"));
  });

  it("masks an opaque segment in the request path and the page url, so a token in a path cannot reach the backend", () => {
    const report = buildReport(
      {
        error: new Error("boom"),
        source: "boundary",
        url: "https://app.example.com/verify/9f8e7d6c5b4a39281706f5e4d3c2b1a0?next=1",
      },
      { ...bareStamp(), path: "/verify/9f8e7d6c5b4a39281706f5e4d3c2b1a0" },
    );

    expect(report.path).toBe(`/verify/${REDACTED}`);
    expect(report.url).toBe(`https://app.example.com/verify/${REDACTED}`);
  });

  it("masks the bound values of a tagged query failure, so a database error cannot carry row data into a report", () => {
    const report = buildReport(
      {
        error: {
          _tag: "QueryError",
          cause: new Error("Failed query: select 1\nparams: fake-row-value"),
        },
        source: "trpc",
      },
      bareStamp(),
    );

    expect(report.message).toContain("Failed query: select 1");
    expect(report.message).not.toContain("fake-row-value");
  });
});
