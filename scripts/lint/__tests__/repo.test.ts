import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diskRepo, memoryRepo } from "../repo";

const realRepo = () => diskRepo(fileURLToPath(new URL("../../../", import.meta.url)));

describe("memoryRepo", () => {
  it("lists only paths under the directory, sorted, and not a sibling whose name starts the same", () => {
    const repo = memoryRepo({
      "app/b.ts": "",
      "application/x.ts": "",
      "app/lib/c.ts": "",
      "app/a.ts": "",
      "workers/w.ts": "",
    });

    expect(repo.files("app")).toEqual(["app/a.ts", "app/b.ts", "app/lib/c.ts"]);
  });

  it("parses a source once and hands back the same object, so rules sharing a file share one AST", () => {
    const repo = memoryRepo({ "app/a.ts": "export const a = 1;" });

    const first = repo.source("app/a.ts");

    expect(first).toMatchObject({ path: "app/a.ts", text: "export const a = 1;" });
    expect(first?.ast.statements).toHaveLength(1);
    expect(repo.source("app/a.ts")).toBe(first);
  });

  it("gives undefined for a path it does not hold", () => {
    const repo = memoryRepo({ "app/a.ts": "" });

    expect(repo.read("app/missing.ts")).toBeUndefined();
    expect(repo.source("app/missing.ts")).toBeUndefined();
  });
});

describe("diskRepo against this repo", () => {
  it("lists files under a directory as repo-relative paths, walking into subfolders", () => {
    expect(realRepo().files("scripts/lint")).toContain("scripts/lint/rules/no-throw.ts");
  });

  it("gives an empty list for a directory that does not exist", () => {
    expect(realRepo().files("no-such-dir")).toEqual([]);
  });

  it("gives undefined for a missing file and for a directory, so a folder never reads as a file", () => {
    const repo = realRepo();

    expect(repo.read("scripts/lint/rules/no-such-rule.ts")).toBeUndefined();
    expect(repo.read("scripts/lint/rules")).toBeUndefined();
    expect(repo.source("scripts/lint/rules")).toBeUndefined();
  });
});
