import { Effect, type ParseResult, Schema } from "effect";
import {
  BROWSER_ERROR_SOURCES,
  BROWSER_REPORT_ACCEPTED_STATUS,
  BROWSER_REPORT_BAD_BODY_STATUS,
  BROWSER_REPORT_CONTENT_TYPE,
  BROWSER_REPORT_TOO_LARGE_STATUS,
  BROWSER_REPORT_WRONG_TYPE_STATUS,
  CSP_REPORT_CONTENT_TYPE,
  CSP_VIOLATION_ERROR_NAME,
  CSP_VIOLATION_REPORT_TYPE,
  MAX_CSP_DIRECTIVE_LENGTH,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_REPORT_BODY_BYTES,
  MAX_REPORT_TYPE_LENGTH,
  MAX_REPORT_URL_LENGTH,
  MAX_REPORTS_PER_BODY,
  OPAQUE_ORIGIN,
  REPORTING_API_CONTENT_TYPE,
  REQUEST_ID_PATTERN,
} from "@/lib/constants/error-reporting";
import { ExternalServiceError, ValidationError } from "@/models/errors/repository";
import type { BrowserErrorPayload } from "./browser-payload";
import { withoutQuery, type ErrorCapture } from "./report";

const capped = (max: number) => Schema.String.pipe(Schema.maxLength(max));

export const BrowserErrorReportSchema = Schema.Struct({
  source: Schema.Literal(...BROWSER_ERROR_SOURCES),
  name: capped(MAX_ERROR_NAME_LENGTH),
  message: capped(MAX_ERROR_MESSAGE_LENGTH),
  stack: Schema.optional(capped(MAX_ERROR_STACK_LENGTH)),
  url: capped(MAX_REPORT_URL_LENGTH),
  requestId: Schema.optional(Schema.String.pipe(Schema.pattern(REQUEST_ID_PATTERN))),
});

export const LegacyCspReportSchema = Schema.Struct({
  "csp-report": Schema.Union(
    Schema.Struct({
      "document-uri": capped(MAX_REPORT_URL_LENGTH),
      "blocked-uri": Schema.optional(capped(MAX_REPORT_URL_LENGTH)),
      "effective-directive": capped(MAX_CSP_DIRECTIVE_LENGTH),
    }),
    Schema.Struct({
      "document-uri": capped(MAX_REPORT_URL_LENGTH),
      "blocked-uri": Schema.optional(capped(MAX_REPORT_URL_LENGTH)),
      "violated-directive": capped(MAX_CSP_DIRECTIVE_LENGTH),
    })
  ),
});

const CspViolationReport = Schema.Struct({
  type: Schema.Literal(CSP_VIOLATION_REPORT_TYPE),
  url: Schema.optional(capped(MAX_REPORT_URL_LENGTH)),
  body: Schema.Struct({
    documentURL: capped(MAX_REPORT_URL_LENGTH),
    effectiveDirective: capped(MAX_CSP_DIRECTIVE_LENGTH),
    blockedURL: Schema.optional(capped(MAX_REPORT_URL_LENGTH)),
  }),
});

const OtherReport = Schema.Struct({
  type: capped(MAX_REPORT_TYPE_LENGTH).pipe(
    Schema.filter((type) => type !== CSP_VIOLATION_REPORT_TYPE)
  ),
});

export const ReportingApiReportsSchema = Schema.Array(
  Schema.Union(CspViolationReport, OtherReport)
).pipe(Schema.maxItems(MAX_REPORTS_PER_BODY));

export type ReportIntake =
  | {
      readonly status: typeof BROWSER_REPORT_ACCEPTED_STATUS;
      readonly captures: ReadonlyArray<ErrorCapture>;
    }
  | {
      readonly status:
        | typeof BROWSER_REPORT_BAD_BODY_STATUS
        | typeof BROWSER_REPORT_TOO_LARGE_STATUS
        | typeof BROWSER_REPORT_WRONG_TYPE_STATUS;
      readonly reason: string;
    };

export type CappedText =
  | { readonly fits: true; readonly text: string }
  | { readonly fits: false };

type ReportKind = "browser-error" | "legacy-csp" | "reporting-api";

const tooLarge = (): CappedText => ({ fits: false });

const readWithin = async (
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<CappedText> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return { fits: true, text: text + decoder.decode() };
    bytes += chunk.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return tooLarge();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
};

export const readCappedText = (
  request: Request,
  maxBytes: number
): Effect.Effect<CappedText, ExternalServiceError> => {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    return Effect.succeed(tooLarge());
  }
  const body = request.body;
  if (body === null) return Effect.succeed({ fits: true, text: "" });
  return Effect.tryPromise({
    try: () => readWithin(body, maxBytes),
    catch: (cause) => new ExternalServiceError({ service: "RequestBody", cause }),
  });
};

const reportKindOf = (contentType: string | null): ReportKind | undefined => {
  const [mediaType = ""] = (contentType ?? "").split(";");
  switch (mediaType.trim().toLowerCase()) {
    case BROWSER_REPORT_CONTENT_TYPE:
      return "browser-error";
    case CSP_REPORT_CONTENT_TYPE:
      return "legacy-csp";
    case REPORTING_API_CONTENT_TYPE:
      return "reporting-api";
    default:
      return undefined;
  }
};

const browserCapture = (report: BrowserErrorPayload): ErrorCapture => ({
  error: { name: report.name, message: report.message, stack: report.stack },
  source: report.source,
  url: report.url,
  requestId: report.requestId,
});

const blockedTarget = (blocked: string): string => {
  if (!URL.canParse(blocked)) return blocked;
  const parsed = new URL(blocked);
  if (parsed.origin === OPAQUE_ORIGIN) return parsed.protocol;
  return withoutQuery(blocked) ?? blocked;
};

const cspCapture = (
  documentUrl: string,
  directive: string,
  blocked: string | undefined
): ErrorCapture => ({
  error: {
    name: CSP_VIOLATION_ERROR_NAME,
    message: `${directive} blocked ${blockedTarget(blocked ?? "")}`.trim(),
  },
  source: "csp",
  level: "warning",
  url: documentUrl,
});

const decodeCaptures = (
  kind: ReportKind,
  json: unknown
): Effect.Effect<ReadonlyArray<ErrorCapture>, ParseResult.ParseError> => {
  switch (kind) {
    case "browser-error":
      return Schema.decodeUnknown(BrowserErrorReportSchema)(json).pipe(
        Effect.map((report) => [browserCapture(report)])
      );
    case "legacy-csp":
      return Schema.decodeUnknown(LegacyCspReportSchema)(json).pipe(
        Effect.map(({ "csp-report": report }) => [
          cspCapture(
            report["document-uri"],
            "effective-directive" in report
              ? report["effective-directive"]
              : report["violated-directive"],
            report["blocked-uri"]
          ),
        ])
      );
    case "reporting-api":
      return Schema.decodeUnknown(ReportingApiReportsSchema)(json).pipe(
        Effect.map((reports) =>
          reports.flatMap((report) =>
            "body" in report
              ? [
                  cspCapture(
                    report.body.documentURL,
                    report.body.effectiveDirective,
                    report.body.blockedURL
                  ),
                ]
              : []
          )
        )
      );
  }
};

const rejected = (
  status: Exclude<ReportIntake["status"], typeof BROWSER_REPORT_ACCEPTED_STATUS>,
  reason: string
): ReportIntake => ({ status, reason });

const parseJson = (text: string): Effect.Effect<unknown, ValidationError> =>
  Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () =>
      new ValidationError({ entity: "browser-report", message: "body is not JSON" }),
  });

const intakeOf = (kind: ReportKind, read: CappedText): Effect.Effect<ReportIntake> => {
  if (!read.fits) {
    return Effect.succeed(rejected(BROWSER_REPORT_TOO_LARGE_STATUS, "body too large"));
  }
  return parseJson(read.text).pipe(
    Effect.matchEffect({
      onFailure: () =>
        Effect.succeed(rejected(BROWSER_REPORT_BAD_BODY_STATUS, "body is not JSON")),
      onSuccess: (json) =>
        decodeCaptures(kind, json).pipe(
          Effect.match({
            onFailure: () =>
              rejected(BROWSER_REPORT_BAD_BODY_STATUS, "body does not match the schema"),
            onSuccess: (captures): ReportIntake => ({
              status: BROWSER_REPORT_ACCEPTED_STATUS,
              captures,
            }),
          })
        ),
    })
  );
};

export const readBrowserReports = (request: Request): Effect.Effect<ReportIntake> => {
  const kind = reportKindOf(request.headers.get("content-type"));
  if (kind === undefined) {
    return Effect.succeed(
      rejected(BROWSER_REPORT_WRONG_TYPE_STATUS, "unsupported content type")
    );
  }
  return readCappedText(request, MAX_REPORT_BODY_BYTES).pipe(
    Effect.matchEffect({
      onFailure: () =>
        Effect.succeed(rejected(BROWSER_REPORT_BAD_BODY_STATUS, "body could not be read")),
      onSuccess: (read) => intakeOf(kind, read),
    })
  );
};
