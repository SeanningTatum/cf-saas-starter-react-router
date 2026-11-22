export const ERROR_SOURCES = [
  "fetch",
  "loader",
  "action",
  "render",
  "trpc",
  "upload",
  "boundary",
  "window",
  "rejection",
  "recoverable",
  "handled",
  "csp",
] as const;

export const BROWSER_ERROR_SOURCES = [
  "boundary",
  "window",
  "rejection",
  "recoverable",
  "handled",
] as const;

export const ERROR_KINDS = ["expected", "defect"] as const;

export const ERROR_LEVELS = ["warning", "error"] as const;

export const BROWSER_REPORT_PATH = "/api/browser-report";

export const CSP_REPORT_GROUP = "csp";

export const BROWSER_REPORT_CONTENT_TYPE = "application/json";
export const CSP_REPORT_CONTENT_TYPE = "application/csp-report";
export const REPORTING_API_CONTENT_TYPE = "application/reports+json";

export const MAX_REPORT_BODY_BYTES = 64 * 1024;
export const MAX_UTF8_BYTES_PER_CODE_UNIT = 3;
export const MAX_REPORTS_PER_BODY = 10;
export const MAX_REPORTS_PER_REQUEST = 10;
export const MAX_BROWSER_REPORTS_PER_PAGE = 10;

export const MAX_ERROR_NAME_LENGTH = 128;
export const MAX_ERROR_MESSAGE_LENGTH = 1024;
export const MAX_ERROR_STACK_LENGTH = 8 * 1024;
export const MAX_REPORT_URL_LENGTH = 2048;

export const BROWSER_REPORT_WINDOW_MS = 60_000;
export const BROWSER_REPORT_WINDOW_LIMIT = 120;

export const SENTRY_TIMEOUT_MS = 5000;
export const SENTRY_CLIENT = "cf-saas-starter/1";
export const SENTRY_PROTOCOL_VERSION = "7";

export const REPORT_ID_BYTES = 16;

export const UNKNOWN_RELEASE = "unversioned";
export const DEVELOPMENT_ENVIRONMENT = "development";
export const PRODUCTION_ENVIRONMENT = "production";

export const UNKNOWN_ERROR_NAME = "Error";
export const TRPC_ERROR_NAME = "TRPCError";
export const TRPC_SERVER_FAILURE_CODES: ReadonlyArray<string> = [
  "INTERNAL_SERVER_ERROR",
  "NOT_IMPLEMENTED",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
];
export const FIRST_SERVER_ERROR_STATUS = 500;

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export const HTTP_STATUS_ATTRIBUTE = "http.response.status_code";

export const BROWSER_REPORT_METHOD = "POST";
export const BROWSER_ERROR_EVENT = "error";
export const BROWSER_REJECTION_EVENT = "unhandledrejection";
export const UNKNOWN_ERROR_MESSAGE = "Unknown error";
export const URL_SUFFIX_PATTERN = /[?#]/;
export const FINGERPRINT_SEPARATOR = "|";
export const STACK_LINE_BREAK = "\n";
const MILLISECONDS_PER_SECOND = 1000;
export const BROWSER_REPORT_RETRY_AFTER_SECONDS = Math.ceil(
  BROWSER_REPORT_WINDOW_MS / MILLISECONDS_PER_SECOND
);
export const BROWSER_REPORT_ACCEPTED_STATUS = 204;
export const BROWSER_REPORT_BAD_BODY_STATUS = 400;
export const BROWSER_REPORT_WRONG_METHOD_STATUS = 405;
export const BROWSER_REPORT_TOO_LARGE_STATUS = 413;
export const BROWSER_REPORT_WRONG_TYPE_STATUS = 415;
export const BROWSER_REPORT_BUDGET_SPENT_STATUS = 429;
export const BROWSER_REPORT_FAILED_STATUS = 500;
export const CSP_VIOLATION_REPORT_TYPE = "csp-violation";
export const CSP_VIOLATION_ERROR_NAME = "CspViolation";
export const MAX_CSP_DIRECTIVE_LENGTH = 128;
export const MAX_REPORT_TYPE_LENGTH = 64;
export const OPAQUE_ORIGIN = "null";
export const MAX_CAUSE_DEPTH = 5;
export const REMOTE_REPORT_WINDOW_MS = 60_000;
export const REMOTE_REPORT_WINDOW_LIMIT = 300;
export const ROUTE_ERROR_RESPONSE_NAME = "RouteErrorResponse";
export const LOCAL_HOSTNAMES: ReadonlyArray<string> = ["localhost", "127.0.0.1"];
export const READ_METHODS: ReadonlyArray<string> = ["GET", "HEAD"];
