import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRules } from "../registry";
import { diskRepo } from "../repo";
import { loadsEveryRuleTimeoutMs } from "./fixtures";

const ruleFileNames = (): string[] =>
  diskRepo(fileURLToPath(new URL("../../../", import.meta.url)))
    .files("scripts/lint/rules")
    .filter((path) => path.endsWith(".ts"))
    .map((path) => path.replace(/^scripts\/lint\/rules\//, "").replace(/\.ts$/, ""))
    .sort();

describe("loadRules", () => {
  it(
    "loads one rule per file in scripts/lint/rules, sorted by id, each id equal to its file name, with no problems",
    async () => {
      const { rules, problems } = await loadRules();

      expect(problems).toEqual([]);
      expect(ruleFileNames().length).toBeGreaterThan(0);
      expect(rules.map((rule) => rule.id)).toEqual(ruleFileNames());
    },
    loadsEveryRuleTimeoutMs,
  );
});
