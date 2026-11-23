import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  BEARER_PATTERN,
  CREDENTIAL_HEADER_PATTERN,
  EMAIL_HASH_LENGTH,
  EMAIL_HASH_PREFIX,
  EMAIL_PATTERN,
  EMAIL_SIGN,
  BINARY,
  JWT_PATTERN,
  MAX_LOG_TEXT_LENGTH,
  MAX_REDACTION_ITEMS,
  MAX_REDACTION_DEPTH,
  OPAQUE_PATH_SEGMENT_PATTERN,
  QUERY_FAILURE_MARKER,
  QUERY_PARAMS_MARKER,
  REDACTED,
  REDACTION_INPUT_SLACK,
  SECRET_PAIR_PATTERN,
  SENSITIVE_KEY_PATTERN,
  CIRCULAR,
  TOO_DEEP,
  URL_USERINFO_PATTERN,
} from "@/lib/constants/redaction";

export const hashEmail = (email: string): string =>
  EMAIL_HASH_PREFIX +
  bytesToHex(sha256(utf8ToBytes(email.trim().toLowerCase()))).slice(0, EMAIL_HASH_LENGTH);

const withoutQueryParams = (text: string): string => {
  const failure = text.indexOf(QUERY_FAILURE_MARKER);
  const params = failure < 0 ? -1 : text.indexOf(QUERY_PARAMS_MARKER, failure);
  return params < 0 ? text : `${text.slice(0, params + QUERY_PARAMS_MARKER.length)} ${REDACTED}`;
};

const withoutEmails = (text: string): string =>
  text.includes(EMAIL_SIGN) ? text.replace(EMAIL_PATTERN, hashEmail) : text;

export const redactText = (text: string): string =>
  withoutEmails(
    withoutQueryParams(text)
      .replace(CREDENTIAL_HEADER_PATTERN, `$1${REDACTED}`)
      .replace(BEARER_PATTERN, `$1${REDACTED}`)
      .replace(JWT_PATTERN, REDACTED)
      .replace(SECRET_PAIR_PATTERN, `$1${REDACTED}`)
      .replace(URL_USERINFO_PATTERN, `$1${REDACTED}@`),
  );

export const redactPath = (path: string): string =>
  path.replace(OPAQUE_PATH_SEGMENT_PATTERN, `$1${REDACTED}`);

export const redactWithin = (text: string, max: number): string =>
  redactText(text.slice(0, max * REDACTION_INPUT_SLACK)).slice(0, max);

const redactEntries = (value: object, ancestors: ReadonlyArray<object>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_REDACTION_ITEMS)
      .map(([key, item]) => [
        redactText(key),
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(item, ancestors),
      ]),
  );

const redactValue = (value: unknown, ancestors: ReadonlyArray<object>): unknown => {
  if (typeof value === "string") return redactWithin(value, MAX_LOG_TEXT_LENGTH);
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object" || value === null || value instanceof Date) {
    return value;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return BINARY;
  if (ancestors.includes(value)) return CIRCULAR;
  if (ancestors.length >= MAX_REDACTION_DEPTH) return TOO_DEEP;
  const within = [...ancestors, value];
  if (Array.isArray(value)) {
    return value.slice(0, MAX_REDACTION_ITEMS).map((item) => redactValue(item, within));
  }
  if (value instanceof Error) {
    return redactEntries({ name: value.name, message: value.message, stack: value.stack }, within);
  }
  return redactEntries(value, within);
};

export const redactFields = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  redactEntries(fields, [fields]);

export const redactDeep = (value: unknown): unknown => redactValue(value, []);
