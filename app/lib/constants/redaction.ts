export const REDACTED = "[redacted]";

export const EMAIL_HASH_PREFIX = "email:";
export const EMAIL_HASH_LENGTH = 16;

export const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g;

export const CREDENTIAL_HEADER_PATTERN =
  /((?:authorization|cookie)["']?\s*[=:]\s*)[^\n]*/gi;

export const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

export const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

export const SECRET_WORDS = [
  "token",
  "password",
  "passwd",
  "secret",
  "api[_-]?key",
  "session",
  "credential",
  "jwt",
  "otp",
  "signature",
] as const;

const CREDENTIAL_HEADER_WORDS = ["authorization", "cookie"] as const;

export const SECRET_PAIR_PATTERN = new RegExp(
  `((?:${SECRET_WORDS.join("|")})[A-Za-z0-9_-]{0,32}["']?[ \\t]{0,4}[=:][ \\t]{0,4})(?:"[^"\\n]*"|'[^'\\n]*'|["']?[^\\s&,;"']+)`,
  "gi"
);

export const URL_USERINFO_PATTERN = /(:\/\/[^/\s:@]{1,64}:)[^/\s@]{1,128}@/g;

export const QUERY_FAILURE_MARKER = "Failed query:";
export const QUERY_PARAMS_MARKER = "\nparams:";

export const OPAQUE_PATH_SEGMENT_PATTERN =
  /(\/)(?=[^/]*\d)[A-Za-z0-9_~.-]{24,}(?=\/|$)/g;

export const REDACTION_INPUT_SLACK = 2;

export const SENSITIVE_KEY_PATTERN = new RegExp(
  [...CREDENTIAL_HEADER_WORDS, ...SECRET_WORDS].join("|"),
  "i"
);

export const MAX_REDACTION_DEPTH = 6;
export const MAX_LOG_TEXT_LENGTH = 16 * 1024;
export const TOO_DEEP = "[too deep]";
export const CIRCULAR = "[circular]";
export const MAX_REDACTION_ITEMS = 100;
export const BINARY = "[binary]";
export const ALWAYS_KEPT_ANNOTATION = "audit";
export const MAX_SPAN_TEXT_LENGTH = 512;
export const UNWRITABLE_LOG_LINE = "log line could not be redacted; fields dropped";
export const EMAIL_SIGN = "@";
export const UNPRINTABLE_ATTRIBUTE = "[unprintable]";
export const FORCED_TRACE_EXPORT_WINDOW_MS = 60_000;
export const FORCED_TRACE_EXPORT_WINDOW_LIMIT = 60;
