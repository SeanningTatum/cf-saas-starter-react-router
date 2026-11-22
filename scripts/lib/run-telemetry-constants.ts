export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const RUN_FILE_VERSION = 1;
export const VERIFY_DIR = ".verify";
export const RUN_FILE_NAME = "run.json";
export const JOURNAL_FILE_NAME = "journal.jsonl";
export const AGENT_FILE_PREFIX = "agent-";
export const TRANSCRIPT_SUFFIX = ".jsonl";
export const META_SUFFIX = ".meta.json";

export const OUTCOMES = ["ok", "empty", "threw"] as const;
export const OUTCOME_OK = "ok";
export const OUTCOME_EMPTY = "empty";
export const FIRST_ATTEMPT = 1;
export const CALL_FIELD_COUNT = 7;
export const FIELD_MAX_LENGTH = 120;
export const LEDGER_TEXT_FIELDS = ["label", "phase", "agent", "model", "verdict"] as const;
export const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const VERDICT_PASS = "pass";
export const VERDICT_FAIL = "fail";
export const BOOLEAN_VERDICT_KEYS = ["ok", "pass", "passed"] as const;

export const FNV_OFFSET_BASIS = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;
export const CHECKSUM_DIGITS = 8;
export const HEX_RADIX = 16;

export const MS_PER_SECOND = 1000;
export const SECONDS_DECIMALS = 1;
export const PERCENT_DECIMALS = 1;
export const PERCENT_SCALE = 100;
export const JSON_INDENT = 2;

export const NOT_AVAILABLE = "n/a";
export const PARTIAL_MARK = "*";
export const TOTAL_LABEL = "total";
export const NO_AGENT_LABEL = "(none)";
export const COLUMN_GAP = "  ";
export const PHASE_SEPARATOR = " / ";

export const EXIT_OK = 0;
export const EXIT_BAD_INPUT = 1;
export const EXIT_USAGE = 2;

export const MESSAGE_PREFIX = "run-telemetry:";
export const USAGE_TEXT =
  "usage: bun scripts/run-telemetry.ts record <slug> <workflow> < ledger | ingest <slug> <workflow> <transcriptDir>... | summary <slug> [--markdown] | stats [--dir <dir>] [--markdown]";

export const VERB_RECORD = "record";
export const VERB_INGEST = "ingest";
export const VERB_SUMMARY = "summary";
export const VERB_STATS = "stats";
export const FLAG_MARKDOWN = "--markdown";
export const FLAG_DIR = "--dir";
export const FLAG_PREFIX = "--";

export const CALL_HEADERS = ["calls", "retries", "failed", "tokens in", "tokens out", "seconds"] as const;
export const COST_HEADERS = ["feature", "calls", "tokens in", "tokens out", "seconds"] as const;
export const FAILURE_HEADERS = ["agent", "failed", "calls", "rate"] as const;
export const PHASE_HEADER = "phase";
export const COST_TITLE = "Cost per feature";
export const SLOWEST_TITLE = "Slowest phase";
export const FAILURE_TITLE = "Failure rate by agent";
export const TOKEN_DATA_NAME = "token data";
export const TIMING_NAME = "timing";
export const NOT_FOUND_CODE = "ENOENT";
