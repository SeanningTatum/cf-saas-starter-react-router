import { describe, expect, it } from "vitest";
import { BASELINE_CHECKS } from "../baseline";
import { RULES_END, RULES_START } from "../constants";
import { applyRules, checkPage, renderRules } from "../rules-page";
import { badWordRule } from "./fixtures";

const page = (body: string) => `# Lint rules\n\nIntro.\n\n${RULES_START}\n${body}\n${RULES_END}\n\nOutro.\n`;

describe("renderRules", () => {
  it("escapes a | inside a cell and folds a newline, so neither splits the markdown row", () => {
    const table = renderRules([badWordRule({ matches: "`a | b`", covers: "line one\n   line two" })]);
    const row = table.split("\n").find((line) => line.startsWith("| `no-bad`"));

    expect(row).toContain("`a \\| b`");
    expect(row).toContain("line one line two");
    expect(row?.split(/(?<!\\)\|/)).toHaveLength(8);
  });

  it("escapes a backslash before it escapes a pipe, so a cell that ends in a backslash cannot un-escape the next pipe", () => {
    const table = renderRules([badWordRule({ matches: "ends in a backslash \\" })]);
    const row = table.split("\n").find((line) => line.startsWith("| `no-bad`"));

    expect(row).toContain("ends in a backslash \\\\ |");
  });

  it("prints a row for every baseline check, so the baseline-* ids in a finding are documented", () => {
    const table = renderRules([badWordRule()]);

    for (const check of Object.values(BASELINE_CHECKS)) expect(table).toContain(`| \`${check.id}\` |`);
  });
});

describe("applyRules", () => {
  it("replaces only the text between the markers and leaves the rest of the page byte for byte", () => {
    expect(applyRules(page("old table"), "NEW TABLE")).toBe(page("NEW TABLE"));
  });

  it("gives the same page when run twice, so --check-docs passes right after --write-docs", () => {
    const once = applyRules(page("old table"), "NEW TABLE") ?? "";

    expect(applyRules(once, "NEW TABLE")).toBe(once);
  });

  it.each([
    ["no markers", "# Lint rules\n"],
    ["only the start marker", `${RULES_START}\nold`],
    ["the end marker before the start marker", `${RULES_END}\nold\n${RULES_START}`],
  ])("returns undefined with %s", (_name, text) => {
    expect(applyRules(text, "NEW TABLE")).toBeUndefined();
  });
});

describe("checkPage", () => {
  it.each([
    ["a missing page", undefined, "is missing"],
    ["a page with no markers", "# Lint rules\n", "has no"],
    ["a stale table", page("old table"), "is stale"],
  ])("reports %s and names the command that fixes it", (_name, text, expected) => {
    const state = checkPage(text, "NEW TABLE");

    expect(state.fresh).toBe(false);
    if (state.fresh) return;
    expect(state.problem).toContain(expected);
    expect(state.problem).toContain("bun run lint:house --write-docs");
  });

  it("accepts a page whose table matches", () => {
    expect(checkPage(page("NEW TABLE"), "NEW TABLE")).toEqual({ fresh: true });
  });
});
