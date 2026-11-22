import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  BEARER_PATTERN,
  CREDENTIAL_HEADER_PATTERN,
  EMAIL_HASH_LENGTH,
  EMAIL_HASH_PREFIX,
  EMAIL_PATTERN,
  JWT_PATTERN,
  OPAQUE_PATH_SEGMENT_PATTERN,
  QUERY_FAILURE_MARKER,
  QUERY_PARAMS_MARKER,
  REDACTED,
  REDACTION_INPUT_SLACK,
  SECRET_PAIR_PATTERN,
  URL_USERINFO_PATTERN,
} from "@/lib/constants/redaction";

export const hashEmail = (email: string): string =>
  EMAIL_HASH_PREFIX +
  bytesToHex(sha256(utf8ToBytes(email.trim().toLowerCase()))).slice(
    0,
    EMAIL_HASH_LENGTH
  );

const withoutQueryParams = (text: string): string => {
  const failure = text.indexOf(QUERY_FAILURE_MARKER);
  const params = failure < 0 ? -1 : text.indexOf(QUERY_PARAMS_MARKER, failure);
  return params < 0
    ? text
    : `${text.slice(0, params + QUERY_PARAMS_MARKER.length)} ${REDACTED}`;
};

export const redactText = (text: string): string =>
  withoutQueryParams(text)
    .replace(CREDENTIAL_HEADER_PATTERN, `$1${REDACTED}`)
    .replace(BEARER_PATTERN, `$1${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(SECRET_PAIR_PATTERN, `$1${REDACTED}`)
    .replace(URL_USERINFO_PATTERN, `$1${REDACTED}@`)
    .replace(EMAIL_PATTERN, hashEmail);

export const redactPath = (path: string): string =>
  path.replace(OPAQUE_PATH_SEGMENT_PATTERN, `$1${REDACTED}`);

export const redactWithin = (text: string, max: number): string =>
  redactText(text.slice(0, max * REDACTION_INPUT_SLACK)).slice(0, max);
