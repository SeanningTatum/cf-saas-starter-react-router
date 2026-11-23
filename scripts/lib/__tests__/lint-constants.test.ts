import { describe, expect, it } from "vitest";
import { DEAD_CODE_FIX, EXIT, FORMAT_FIX, LINTABLE_FILE } from "../lint-constants";

describe("lint constants", () => {
  it("keeps clean at 0 and the three exit codes distinct, so findings and a broken tool never read as a pass or as each other", () => {
    expect(EXIT.clean).toBe(0);
    expect(new Set([EXIT.clean, EXIT.findings, EXIT.toolFailed]).size).toBe(3);
  });

  it.each(Object.entries(DEAD_CODE_FIX))("gives the %s dead-code kind a fix that says what to do", (_kind, fix) => {
    expect(fix).toContain("Do this instead");
  });

  it("gives the format finding a fix that says what to do", () => {
    expect(FORMAT_FIX).toContain("Do this instead");
  });

  it.each(["app/a.ts", "app/b.tsx", "package.json", "app/app.css", "scripts/x.mjs"])("lints %s", (file) => {
    expect(LINTABLE_FILE.test(file)).toBe(true);
  });

  it.each(["README.md", "scripts/setup.sh", ".github/workflows/ci.yml", "app/a.ts.orig", "tsconfig.json.bak"])("does not pass %s to the linters", (file) => {
    expect(LINTABLE_FILE.test(file)).toBe(false);
  });
});
