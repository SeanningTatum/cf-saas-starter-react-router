import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { evaluate, jobsOf, jobsThatRun } from "./helpers/workflow-jobs";

const DIR = path.join(__dirname, "..", "..", ".github", "workflows");
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf-8");
const codeLines = (f: string) => read(f).split("\n").filter((l) => !/^\s*#/.test(l));

describe("size and Lighthouse on PRs (#159)", () => {
  const ci = jobsOf(read("ci.yml"));
  const job = (id: string) => ci.find((j) => j.id === id);

  it("the comment job is the only ci.yml job with a write permission, asks for pull-requests: write and nothing more, and checks out no PR code", () => {
    const writers = ci.filter((j) => /:\s*write/.test(j.body)).map((j) => j.id);
    expect(writers).toEqual(["report"]);
    expect(job("report")?.body).toMatch(/^ {4}permissions:\n {6}pull-requests: write\n {4}\S/m);
    expect(job("report")?.body).not.toMatch(/actions\/checkout@/);
    expect(job("report")?.needs).toEqual(["size", "lighthouse"]);
  });

  it("the comment job finds its own comment by the hidden marker and edits it, else posts one: one comment per PR, never a pile", () => {
    const body = job("report")?.body ?? "";
    expect(body).toContain("marker='<!-- ci:size-lighthouse -->'");
    expect(body).toContain('select(.user.login == \\"github-actions[bot]\\" and (.body | startswith(\\"$marker\\")))');
    expect(body).toContain('gh api -X PATCH "repos/$REPO/issues/comments/$id" -F body=@comment.md');
  });

  it("size and Lighthouse measure against the base branch, with full history for the worktree, and keep their reports as artifacts", () => {
    for (const id of ["size", "lighthouse"]) {
      expect(job(id)?.body).toMatch(/fetch-depth:\s*0/);
      expect(job(id)?.body).toContain('--base "origin/$BASE_REF"');
      expect(job(id)?.body).toMatch(/actions\/upload-artifact@/);
    }
  });

  it("nothing uploads to a public Lighthouse host: no lhci upload, no temporary-public-storage", () => {
    expect(read("ci.yml")).not.toMatch(/temporary-public-storage|lhci|--upload/);
  });

  it("the required job names are not taken by the new jobs", () => {
    expect(["size", "lighthouse", "report"].map((id) => job(id)?.name)).toEqual([
      "Size (against the base branch)",
      "Lighthouse (mobile, against the base branch)",
      "Size and Lighthouse comment",
    ]);
  });
});

describe("pr-body.yml checks the size table on every PR", () => {
  const lines = codeLines("pr-body.yml");
  const text = lines.join("\n");

  it("runs on opened, edited, synchronize and reopened, with no branches filter: an edited body is checked again, on stacked PRs too", () => {
    expect(text).toMatch(/pull_request:\s*\n\s+types:\s*\[opened, edited, synchronize, reopened\]/);
    expect(text).not.toMatch(/^\s{4}branches:/m);
  });

  it("reads the body only inside an env: block, and the shas from the event", () => {
    const uses = lines.flatMap((line, i) => (/github\.event\.pull_request\.body/.test(line) ? [i] : []));
    expect(uses).toHaveLength(1);
    expect(lines[uses[0] ?? 0]).toMatch(/^\s+PR_BODY:\s*\$\{\{\s*github\.event\.pull_request\.body\s*\}\}\s*$/);
    expect(text).toMatch(/BASE_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/);
    expect(text).toMatch(/HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  });

  it("stays cheap: no build, no install scripts, full history for the diff", () => {
    expect(text).not.toMatch(/bun run build|verify\.sh|bun run size/);
    expect(text).toContain("bun install --frozen-lockfile --ignore-scripts");
    expect(text).toMatch(/fetch-depth:\s*0/);
    expect(text).toContain("run: bun scripts/ci/pr-size-body.ts");
  });
});

describe("the workflow test helper", () => {
  it("the evaluator reads always() as true, and a job that starts with it runs whatever its needs did", () => {
    expect(evaluate("always() && 'a' == 'a'", {})).toBe(true);
    const jobs = jobsOf("jobs:\n  a:\n    if: 'x' == 'y'\n  b:\n    needs: [a]\n    if: always() && 'x' == 'x'\n  c:\n    needs: [a]\n");
    expect(jobsThatRun(jobs, {})).toEqual(["b"]);
  });
});
