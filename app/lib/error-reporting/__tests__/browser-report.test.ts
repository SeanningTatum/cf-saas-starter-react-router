import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BROWSER_REPORT_PATH,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_REPORT_BODY_BYTES,
  MAX_REPORT_URL_LENGTH,
  MAX_REPORTS_PER_BODY,
} from "@/lib/constants/error-reporting";
import {
  BrowserErrorReportSchema,
  readBrowserReports,
  readCappedText,
} from "../browser-report";

const endpoint = `https://app.example.com${BROWSER_REPORT_PATH}`;

const post = (body: BodyInit, contentType: string, headers: Record<string, string> = {}) =>
  new Request(endpoint, {
    method: "POST",
    body,
    headers: { "content-type": contentType, ...headers },
  });

const goodReport = () => ({
  source: "window",
  name: "TypeError",
  message: "x is not a function",
  stack: "TypeError: x is not a function\n    at app.js:1:1",
  url: "https://app.example.com/dashboard?tab=1",
  requestId: "req-123",
});

const intakeOf = (request: Request) => Effect.runPromise(readBrowserReports(request));

const decode = (input: unknown) =>
  Effect.runPromise(Effect.either(Schema.decodeUnknown(BrowserErrorReportSchema)(input)));

const streamOf = (chunks: ReadonlyArray<Uint8Array>, pulled: { count: number }) =>
  new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const next = chunks[pulled.count];
      pulled.count += 1;
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
  });

const streamedPost = (stream: ReadableStream<Uint8Array>, contentLength: string) =>
  new Request(endpoint, {
    method: "POST",
    body: stream,
    headers: { "content-type": "application/json", "content-length": contentLength },
    duplex: "half",
  } as RequestInit);

describe("BrowserErrorReportSchema", () => {
  it("accepts a good report, so that real browser errors reach the reporter", async () => {
    const result = await decode(goodReport());
    expect(result._tag).toBe("Right");
  });

  it.each([
    ["name", "n".repeat(MAX_ERROR_NAME_LENGTH + 1)],
    ["message", "m".repeat(MAX_ERROR_MESSAGE_LENGTH + 1)],
    ["stack", "s".repeat(MAX_ERROR_STACK_LENGTH + 1)],
    ["url", `https://app.example.com/${"u".repeat(MAX_REPORT_URL_LENGTH)}`],
  ])("rejects an over-long %s, so that a caller cannot push huge fields into reports", async (field, value) => {
    const result = await decode({ ...goodReport(), [field]: value });
    expect(result._tag).toBe("Left");
  });

  it("rejects a requestId outside the pattern, so that a forged id cannot smuggle text into reports", async () => {
    const result = await decode({ ...goodReport(), requestId: "bad id; drop" });
    expect(result._tag).toBe("Left");
  });

  it("rejects an unknown source, so that a browser cannot claim a server source", async () => {
    const result = await decode({ ...goodReport(), source: "trpc" });
    expect(result._tag).toBe("Left");
  });

  it("drops unknown extra keys, so that a caller cannot set userId or release on a report", async () => {
    const result = await decode({ ...goodReport(), userId: "u1", release: "fake" });
    expect(result._tag === "Right" ? Object.keys(result.right).sort() : []).toEqual(
      ["message", "name", "requestId", "source", "stack", "url"]
    );
  });
});

describe("readCappedText", () => {
  it("returns the whole body under the cap, so that a normal report is read in full", async () => {
    const read = await Effect.runPromise(readCappedText(post("hello", "text/plain"), MAX_REPORT_BODY_BYTES));
    expect(read).toEqual({ fits: true, text: "hello" });
  });

  it("stops reading a stream that runs over the cap, so that a large body cannot fill memory", async () => {
    const chunk = new Uint8Array(MAX_REPORT_BODY_BYTES / 4);
    const pulled = { count: 0 };
    const chunks = Array.from({ length: 100 }, () => chunk);
    const read = await Effect.runPromise(
      readCappedText(streamedPost(streamOf(chunks, pulled), "1"), MAX_REPORT_BODY_BYTES)
    );
    expect(read).toEqual({ fits: false });
    expect(pulled.count).toBeLessThan(10);
  });
});

describe("readBrowserReports", () => {
  it("maps a good browser report to one capture with its source, url and requestId, so that the report keeps its context", async () => {
    const intake = await intakeOf(post(JSON.stringify(goodReport()), "application/json; charset=UTF-8"));
    expect(intake).toEqual({
      status: 204,
      captures: [
        {
          error: {
            name: "TypeError",
            message: "x is not a function",
            stack: "TypeError: x is not a function\n    at app.js:1:1",
          },
          source: "window",
          url: "https://app.example.com/dashboard?tab=1",
          requestId: "req-123",
        },
      ],
    });
  });

  it("reads the content type case-insensitively, so that a browser that capitalises it is not refused", async () => {
    const intake = await intakeOf(post(JSON.stringify(goodReport()), "Application/JSON"));
    expect(intake.status).toBe(204);
  });

  it("answers 415 for any other content type, so that form posts and plain text are refused", async () => {
    const intake = await intakeOf(post(JSON.stringify(goodReport()), "text/plain"));
    expect(intake.status).toBe(415);
  });

  it("answers 413 when the content-length header is over the cap, so that a large body is refused before it is read", async () => {
    const body = new ReadableStream<Uint8Array>({ pull: () => undefined });
    const intake = await intakeOf(streamedPost(body, String(MAX_REPORT_BODY_BYTES + 1)));
    expect(intake.status).toBe(413);
  });

  it("answers 413 when the body runs past the cap while the header claims less, so that a lying header cannot get round the cap", async () => {
    const body = JSON.stringify({ ...goodReport(), message: "m".repeat(MAX_REPORT_BODY_BYTES) });
    const intake = await intakeOf(post(body, "application/json", { "content-length": "10" }));
    expect(intake.status).toBe(413);
  });

  it("answers 400 on a body that is not JSON, so that junk never reaches the reporter", async () => {
    const intake = await intakeOf(post("{not json", "application/json"));
    expect(intake.status).toBe(400);
  });

  it("maps a legacy report-uri body to a csp warning without the query string, so that a token in a blocked URL is not stored", async () => {
    const body = JSON.stringify({
      "csp-report": {
        "document-uri": "https://app.example.com/login?next=/admin",
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://cdn.example.com/x.js?token=abc123",
        "original-policy": "default-src 'self'",
      },
    });
    const intake = await intakeOf(post(body, "application/csp-report"));
    expect(intake).toEqual({
      status: 204,
      captures: [
        {
          error: { name: "CspViolation", message: "script-src-elem blocked https://cdn.example.com/x.js" },
          source: "csp",
          level: "warning",
          url: "https://app.example.com/login?next=/admin",
        },
      ],
    });
  });

  it("maps Reporting API csp items, keeps keyword blocked values, and drops other report types, so that only CSP reports become captures", async () => {
    const body = JSON.stringify([
      {
        type: "csp-violation",
        url: "https://app.example.com/",
        body: {
          documentURL: "https://app.example.com/",
          effectiveDirective: "script-src-elem",
          blockedURL: "inline",
        },
      },
      { type: "deprecation", url: "https://app.example.com/", body: { id: "x" } },
      {
        type: "csp-violation",
        body: {
          documentURL: "https://app.example.com/admin",
          effectiveDirective: "img-src",
          blockedURL: "https://img.example.com/a.png?sig=abc",
        },
      },
    ]);
    const intake = await intakeOf(post(body, "application/reports+json"));
    expect(intake.status === 204 ? intake.captures.map((c) => [c.source, c.level, c.error, c.url]) : []).toEqual([
      ["csp", "warning", { name: "CspViolation", message: "script-src-elem blocked inline" }, "https://app.example.com/"],
      ["csp", "warning", { name: "CspViolation", message: "img-src blocked https://img.example.com/a.png" }, "https://app.example.com/admin"],
    ]);
  });

  it("answers 400 on a Reporting API array over the item cap, so that one post cannot carry a flood of reports", async () => {
    const item = { type: "deprecation", body: {} };
    const body = JSON.stringify(Array.from({ length: MAX_REPORTS_PER_BODY + 1 }, () => item));
    const intake = await intakeOf(post(body, "application/reports+json"));
    expect(intake.status).toBe(400);
  });

  it("never echoes the posted body in the result, so that personal data in a bad report cannot reach a log line", async () => {
    const marker = "user@example.com";
    const bodies: ReadonlyArray<[string, string]> = [
      [`{"oops": "${marker}"`, "application/json"],
      [JSON.stringify({ ...goodReport(), source: marker }), "application/json"],
      [JSON.stringify({ "csp-report": { "document-uri": marker } }), "application/csp-report"],
      [JSON.stringify([{ type: "csp-violation", body: { documentURL: marker } }]), "application/reports+json"],
      [marker, "text/plain"],
    ];
    for (const [body, contentType] of bodies) {
      const intake = await intakeOf(post(body, contentType));
      expect(intake.status).not.toBe(204);
      expect(JSON.stringify(intake)).not.toContain(marker);
    }
  });
});
