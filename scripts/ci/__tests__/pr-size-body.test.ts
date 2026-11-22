import { describe, expect, it } from "vitest";
import { run, type Deps } from "../pr-size-body";

const TABLE = "| | base | This PR | Change |\n|---|---:|---:|---:|\n| Worker upload, gzip | 1 | 1 | 0 |";

function check(env: Record<string, string | undefined>, diff = { code: 0, stdout: "app/root.tsx\n" }) {
  const lines: string[] = [];
  const ranges: string[] = [];
  const deps: Deps = {
    env,
    diff: (base, head) => {
      ranges.push(`${base}...${head}`);
      return diff;
    },
    log: (line) => lines.push(line),
  };
  return { code: run(deps), lines, ranges };
}

const SHAS = { BASE_SHA: "b".repeat(40), HEAD_SHA: "h".repeat(40) };

describe("pr-size-body", () => {
  it("diffs the PR's base sha against its head sha, from the event, not from the checkout's branch names", () => {
    const result = check({ ...SHAS, PR_BODY: TABLE });
    expect(result.ranges).toEqual([`${SHAS.BASE_SHA}...${SHAS.HEAD_SHA}`]);
    expect(result.code).toBe(0);
  });

  it("fails a PR that changes app/ with no table, as a GitHub error annotation", () => {
    const result = check({ ...SHAS, PR_BODY: "Closes #1" });
    expect(result.code).toBe(1);
    expect(result.lines[0]).toMatch(/^::error::This PR changes shipped code \(app\/root\.tsx\)/);
  });

  it("passes a docs-only PR with an empty body", () => {
    expect(check({ ...SHAS, PR_BODY: "" }, { code: 0, stdout: "docs/a.md\n" }).code).toBe(0);
  });

  it("fails, and does not pass by default, when the shas are missing or git cannot diff them (a shallow checkout)", () => {
    expect(check({ PR_BODY: TABLE }).code).toBe(1);
    const shallow = check({ ...SHAS, PR_BODY: TABLE }, { code: 128, stdout: "" });
    expect(shallow.code).toBe(1);
    expect(shallow.lines[0]).toContain("fetch-depth: 0");
  });

  it("treats a body full of shell syntax as plain text", () => {
    expect(check({ ...SHAS, PR_BODY: `$(rm -rf ~) \`id\`\n${TABLE}` }).code).toBe(0);
  });
});
