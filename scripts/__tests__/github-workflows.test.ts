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

describe("workflows pin every action to a commit", () => {
  it.each(files)(
    "%s: every uses: is owner/repo@<40 hex> # v<version> (a tag can be moved to run other code)",
    (f) => {
      const uses = codeLines(f).filter((l) => /^\s*-?\s*uses\s*:/.test(l));
      expect(uses.length).toBeGreaterThan(0);
      for (const line of uses) {
        expect(line.trim()).toMatch(
          /^(- )?uses:\s+[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40} # v\d+(\.\d+){1,2}$/,
        );
      }
    },
  );

  it.each(files)(
    "%s: every actions/checkout step sets persist-credentials: false (the job token stays out of .git/config)",
    (f) => {
      const lines = codeLines(f);
      lines.forEach((line, i) => {
        if (!/uses:\s*actions\/checkout@/.test(line)) return;
        const indent = line.length - line.trimStart().length;
        const step: string[] = [];
        for (const next of lines.slice(i + 1)) {
          const nextIndent = next.length - next.trimStart().length;
          if (next.trim() !== "" && nextIndent <= indent) break;
          step.push(next);
        }
        expect(step.join("\n")).toMatch(/^\s+persist-credentials:\s*false\s*$/m);
      });
    },
  );
});

describe("workflows hold least-privilege permissions", () => {
  it.each(files)(
    "%s: the top-level permissions block has contents: read and nothing else (a job asks for more itself)",
    (f) => {
      const lines = codeLines(f);
      const start = lines.findIndex((l) => /^permissions:\s*$/.test(l));
      expect(start, "no top-level permissions: block").toBeGreaterThanOrEqual(0);
      const block: string[] = [];
      for (const line of lines.slice(start + 1)) {
        if (line.trim() !== "" && !/^\s/.test(line)) break;
        if (line.trim() !== "") block.push(line.trim());
      }
      expect(block).toEqual(["contents: read"]);
    },
  );

  it.each(files)("%s: no write-all anywhere", (f) => {
    expect(codeLines(f).filter((l) => /write-all/.test(l))).toEqual([]);
  });

  it("codeql.yml gives security-events: write to its analyze job only", () => {
    const writes = codeLines("codeql.yml").filter((l) => /^\s+security-events:\s*write/.test(l));
    expect(writes).toHaveLength(1);
  });

  it("preview.yml gives pull-requests: write at job level, never at the top", () => {
    const lines = codeLines("preview.yml").filter((l) => /pull-requests:\s*write/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].length - lines[0].trimStart().length).toBeGreaterThan(2);
  });
});

describe(".github/dependabot.yml", () => {
  const text = fs.readFileSync(path.join(ROOT, ".github", "dependabot.yml"), "utf-8");
  const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  it.each(["bun", "github-actions"])(
    "has a weekly %s entry with groups (without groups every package is its own pull request)",
    (ecosystem) => {
      const entries = code.split(/^\s*- package-ecosystem:/m).slice(1);
      const entry = entries.find((e) => e.trim().startsWith(`"${ecosystem}"`) || e.trim().startsWith(ecosystem));
      expect(entry, `no ${ecosystem} entry`).toBeDefined();
      expect(entry).toMatch(/interval:\s*"?weekly"?/);
      expect(entry).toMatch(/^\s+groups:\s*$/m);
    },
  );

  it("is version 2", () => {
    expect(code).toMatch(/^version:\s*2\s*$/m);
  });
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

  it("deploy.yml records the restore point before it applies migrations: a backup after the schema change is no way back", () => {
    const lines = codeLines("deploy.yml");
    const backup = lines.findIndex((l) => /scripts\/ci\/d1-backup\.ts/.test(l));
    const migrate = lines.findIndex((l) => /db:migrate:remote/.test(l));
    expect(backup).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(backup).toBeLessThan(migrate);
  });

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
