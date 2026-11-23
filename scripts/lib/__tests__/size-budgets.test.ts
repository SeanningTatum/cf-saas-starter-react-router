import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { budgetRows, failures, parseBudgets, ratchet, renderBudgets, statusOf, type Budgets } from "../size-budgets";
import { NOISE_SLACK_BYTES } from "../size-budgets-constants";
import type { SizeReport } from "../size-report";

const BUDGETS: Budgets = {
  worker: { budget: 1000, target: 900 },
  pages: { "/": { budget: 200_000, target: 180_000 }, "/login": { budget: 300_000 } },
};

const report = (worker: number, home: number, login: number, extra: SizeReport["rows"] = []): SizeReport => ({
  rows: [
    { key: "worker", label: "Worker upload, gzip", bytes: worker },
    { key: "route:routes/home:js", label: "`/` first-load JS, gzip", bytes: home },
    { key: "route:routes/home:css", label: "`/` first-load CSS, gzip", bytes: 9 },
    { key: "route:routes/login:js", label: "`/login` first-load JS, gzip", bytes: login },
    ...extra,
  ],
});

describe("parseBudgets", () => {
  it("reads the checked-in shape and refuses a file with no worker budget", () => {
    expect(Either.isRight(parseBudgets(JSON.stringify(BUDGETS)))).toBe(true);
    expect(Either.isLeft(parseBudgets(JSON.stringify({ pages: {} })))).toBe(true);
    expect(Either.isLeft(parseBudgets("not json"))).toBe(true);
  });
});

describe("failures", () => {
  it("passes a build at or under every budget, and one within the noise slack", () => {
    expect(failures(budgetRows(BUDGETS, report(1000, 200_000, 100_000)))).toEqual([]);
    expect(failures(budgetRows(BUDGETS, report(1000 + NOISE_SLACK_BYTES, 200_000, 300_000)))).toEqual([]);
  });

  it("states the page path and the byte count for an over-budget page", () => {
    const [message] = failures(budgetRows(BUDGETS, report(1000, 205_000, 300_000)));
    expect(message).toMatch(/^\/ is 5,000 bytes over its budget \(205,000 measured, budget 200,000\)/);
    expect(message).toContain("bun run size --base");
    expect(message).toContain("A budget only goes down");
  });

  it("fails the Worker the same way", () => {
    const [message] = failures(budgetRows(BUDGETS, report(5000, 1, 1)));
    expect(message).toMatch(/^Worker upload is 4,000 bytes over its budget/);
  });

  it("fails a page that has no budget yet and says which line to add", () => {
    const rows = budgetRows(BUDGETS, report(1000, 1, 1, [{ key: "route:routes/new:js", label: "`/pricing` first-load JS, gzip", bytes: 777 }]));
    expect(failures(rows)).toEqual([expect.stringContaining('"/pricing": { "budget": 777 }')]);
  });

  it("keeps the larger number when two routes share a path", () => {
    const rows = budgetRows(BUDGETS, report(1, 1, 1, [{ key: "route:routes/other:js", label: "`/login` first-load JS, gzip", bytes: 310_000 }]));
    expect(rows.find((row) => row.name === "/login")?.measured).toBe(310_000);
  });
});

describe("renderBudgets", () => {
  it("prints one row per budget with the gap to the ticket target", () => {
    const text = renderBudgets(budgetRows(BUDGETS, report(1000, 190_000, 300_000)));
    expect(text).toContain("| Worker upload | 1,000 | 1,000 | 0 | 900 | 100 | ok |");
    expect(text).toContain("| / | 190,000 | 200,000 | 10,000 | 180,000 | 20,000 | lower the budget |");
    expect(text).toContain("| /login | 300,000 | 300,000 | 0 | — | — | ok |");
  });

  it("marks a row over its budget", () => {
    expect(statusOf({ name: "/", measured: 300_000, budget: 1, target: undefined })).toBe("OVER");
    expect(statusOf({ name: "/x", measured: 1, budget: undefined, target: undefined })).toBe("NO BUDGET");
  });
});

describe("ratchet", () => {
  it("accepts equal and lower budgets", () => {
    const lower: Budgets = { worker: { budget: 900 }, pages: { "/": { budget: 1 }, "/login": { budget: 300_000 } } };
    expect(ratchet(BUDGETS, lower)).toEqual([]);
    expect(ratchet(BUDGETS, BUDGETS)).toEqual([]);
  });

  it("fails a raised budget with both numbers", () => {
    const raised: Budgets = { ...BUDGETS, pages: { ...BUDGETS.pages, "/": { budget: 210_000 } } };
    expect(ratchet(BUDGETS, raised)).toEqual([expect.stringContaining("/ went up from 200,000 to 210,000")]);
  });

  it("fails a budget that was removed, and a raised Worker budget", () => {
    const head: Budgets = { worker: { budget: 2000 }, pages: { "/": BUDGETS.pages["/"] ?? { budget: 0 } } };
    const found = ratchet(BUDGETS, head);
    expect(found).toHaveLength(2);
    expect(found.join("\n")).toContain("Worker upload went up from 1,000 to 2,000");
    expect(found.join("\n")).toContain("budget for /login was removed");
  });

  it("lets a new page add a budget", () => {
    const grown: Budgets = { ...BUDGETS, pages: { ...BUDGETS.pages, "/new": { budget: 5 } } };
    expect(ratchet(BUDGETS, grown)).toEqual([]);
  });
});
