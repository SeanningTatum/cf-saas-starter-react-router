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

export const SECRET_PAIR_PATTERN =
  /((?:token|password|passwd|secret|api[_-]?key|session|credential)[A-Za-z0-9_-]{0,32}["']?[ \t]{0,4}[=:][ \t]{0,4})(?:"[^"\n]*"|'[^'\n]*'|["']?[^\s&,;"']+)/gi;

export const URL_USERINFO_PATTERN = /(:\/\/[^/\s:@]{1,64}:)[^/\s@]{1,128}@/g;

export const QUERY_FAILURE_MARKER = "Failed query:";
export const QUERY_PARAMS_MARKER = "\nparams:";

export const OPAQUE_PATH_SEGMENT_PATTERN =
  /(\/)(?=[^/]*\d)[A-Za-z0-9_~.-]{24,}(?=\/|$)/g;

export const REDACTION_INPUT_SLACK = 2;
