export const CONFIG_FILE_NAME = "harness.config.json";
export const CONFIG_VERSION = 1;
export const MESSAGE_PREFIX = "harness-config:";

export const EXIT_OK = 0;
export const EXIT_BAD_CONFIG = 1;
export const EXIT_USAGE = 2;

export const VERB_SHOW = "show";
export const VERB_GET = "get";
export const VERB_GATES = "gates";
export const VERB_CHECK = "check";
export const USAGE_TEXT = "usage: bun scripts/harness-config.ts show | get <dotted.key> | gates | check";

export const KEY_SEPARATOR = ".";
export const GATE_FIELD_SEPARATOR = "|";
export const GATE_BASELINE_YES = "y";
export const GATE_BASELINE_NO = "n";
export const GATE_FORBIDDEN_CHARACTERS = /[|\n\r]/;
export const NOT_FOUND_CODE = "ENOENT";

export const DEFAULT_COAUTHOR = "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>";
export const DEFAULT_SCRATCH_DIRS = [".verify/", "tmp/"] as const;
export const DEFAULT_READY_LABEL = "ready-for-agent";
export const DEFAULT_REVIEW_BOT = {
  login: "greptile-apps",
  summaryMarker: "<!-- greptile_summary -->",
  trigger: "@greptileai review",
} as const;
export const DEFAULT_DOCS = {
  product: "PRODUCT.md",
  design: "DESIGN.md",
  glossary: "GLOSSARY.md",
  adr: "docs/adr",
  features: "docs/features",
} as const;
export const DEFAULT_LOGIN_FORM = {
  path: "/login",
  emailTestId: "login-email",
  passwordTestId: "login-password",
  submitTestId: "login-submit",
} as const;

export const MISSING_GATES_LINE = "set gates in harness.config.json";
export const BAD_JSON_LINE = `${CONFIG_FILE_NAME} is not valid JSON`;
export const BAD_GATE_FIELD_LINE = "must not hold a | or a line break";
