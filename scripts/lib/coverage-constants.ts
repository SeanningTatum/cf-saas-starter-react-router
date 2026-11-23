export const COVERAGE_BAR_PERCENT = 90;

export const COVERAGE_FLOORS: Readonly<Record<string, number>> = {
  "app/repositories": 90,
  "app/services": 90,
  "app/trpc": 90,
  "app/lib": 90,
};

export const COVERAGE_TEST_ROOTS = ["app", "workers"];
export const COVERAGE_SUMMARY_FILE = "coverage-summary.json";
export const COVERAGE_TEMP_PREFIX = "coverage-floors-";
export const COVERAGE_DOC = "docs/agents/harness.md#coverage-floors";
export const COVERAGE_WORST_FILES = 5;
export const PERCENT_DECIMALS = 2;
export const FULL_PERCENT = 100;
export const BUNX_BIN = "bunx";
