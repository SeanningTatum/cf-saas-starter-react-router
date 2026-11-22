import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const DIR = path.join(ROOT, ".github", "workflows");
const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf-8");

/** Lines of a workflow with comment-only lines removed. */
const codeLines = (f: string) => read(f).split("\n").filter((l) => !/^\s*#/.test(l));

describe("workflows pin Bun in one place", () => {
  it(".bun-version holds one plain version: setup-bun reads it as is", () => {
    expect(fs.readFileSync(path.join(ROOT, ".bun-version"), "utf-8")).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it.each(files)(
    "%s: no bun-version: key, and every setup-bun step reads .bun-version (a second pin lets deploy drift from CI)",
    (f) => {
      const lines = codeLines(f);
      expect(lines.filter((l) => /^\s*-?\s*bun-version\s*:/.test(l))).toEqual([]);
      const steps = lines.flatMap((line, i) =>
        /uses:\s*oven-sh\/setup-bun@/.test(line) ? [lines.slice(i, i + 4).join("\n")] : [],
      );
      for (const step of steps) {
        expect(step).toMatch(/bun-version-file:\s*\.bun-version\b/);
      }
    },
  );
});

describe("workflows keep secrets and PR data out of shell text", () => {
  it.each(["deploy.yml", "preview.yml", "preview-cleanup.yml"])(
    "%s has no ${{ }} expression inside a run script: PR-controlled values must go through env",
    (f) => {
      const lines = codeLines(f);
      let runIndent: number | undefined;
      const offenders: string[] = [];
      for (const line of lines) {
        const indent = line.length - line.trimStart().length;
        if (runIndent !== undefined && line.trim() !== "" && indent <= runIndent) runIndent = undefined;
        if (runIndent !== undefined && /\$\{\{/.test(line)) offenders.push(line.trim());
        const m = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
        if (m) {
          if (/\$\{\{/.test(m[2])) offenders.push(line.trim());
          if (m[2] === "|" || m[2] === ">" || m[2] === ">-" || m[2] === "|-") runIndent = indent;
        }
      }
      expect(offenders).toEqual([]);
    },
  );

  it.each(["preview.yml", "preview-cleanup.yml"])(
    "%s never names the production token: jobs that run PR code must not read it",
    (f) => {
      const uses = codeLines(f).filter((l) => /secrets\.CLOUDFLARE_API_TOKEN\b/.test(l));
      // The readiness job may test whether it is set (it sees a boolean, not the value).
      for (const line of uses) {
        expect(line).toMatch(/PROD_TOKEN_AT_REPO_LEVEL:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN != ''\s*\}\}/);
      }
    },
  );

  it("deploy.yml gives the token only to steps, never at job level", () => {
    const tokenLines = codeLines("deploy.yml").filter((l) => /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\./.test(l));
    expect(tokenLines.length).toBeGreaterThan(0);
    for (const line of tokenLines) {
      // Step-level env sits at 10 spaces; job-level env at 6.
      expect(line.length - line.trimStart().length).toBeGreaterThanOrEqual(10);
    }
  });
});
