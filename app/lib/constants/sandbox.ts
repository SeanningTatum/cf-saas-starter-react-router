export const SANDBOX_BUILD_FLAG = "VITE_SANDBOX";
export const SANDBOX_ENABLED_VAR = "SANDBOX_ENABLED";
export const SANDBOX_ON = "1";

export const SANDBOX_PAGE_PATH = "/sandbox";
export const SANDBOX_MANIFEST_VERSION = 1;
export const SANDBOX_CASE_KEY_SEPARATOR = ":";

export const SANDBOX_QUERY = {
  module: "module",
  case: "case",
  scenario: "scenario",
  lng: "lng",
  theme: "theme",
} as const;

export const SANDBOX_LOCALES = ["en", "zh"] as const;
export const SANDBOX_DEFAULT_LOCALE = "en";
export const SANDBOX_THEMES = ["light", "dark"] as const;
export const SANDBOX_DEFAULT_THEME = "light";

export const SANDBOX_STATUS = {
  ok: 200,
  notFound: 404,
  wrongMethod: 405,
  brokenFixture: 500,
} as const;

export const SANDBOX_NOT_FOUND_BODY = "Not Found";
export const SANDBOX_BROKEN_BODY = "Internal Server Error";
export const SANDBOX_ALLOWED_METHODS = "GET, HEAD";
export const SANDBOX_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
} as const;

export const SANDBOX_MODULE_IDS = ["users-table", "file-upload"] as const;

export const SANDBOX_MODULE_TABLE = [
  {
    id: "users-table",
    title: "Users table",
    description: "The admin users table, with paging, roles and the banned badge.",
    needsRole: "admin",
    cases: [
      { id: "list", label: "List", scenarios: ["base", "many-users"] },
      { id: "empty", label: "Empty", scenarios: ["empty"] },
    ],
  },
  {
    id: "file-upload",
    title: "File upload",
    description: "The upload card in its idle state, before a file is picked.",
    cases: [{ id: "idle", label: "Idle", scenarios: ["base", "empty", "many-users"] }],
  },
] as const;
