import { describe, expect, it } from "vitest";
import { sourceOf } from "../../__tests__/fixtures";
import { importedModules, importsFile, withoutExtension } from "../imports";

const TEST_FILE = "app/trpc/__tests__/index.test.ts";

const modulesOf = (text: string, path = TEST_FILE): string[] => importedModules(sourceOf(text, path));

describe("importedModules", () => {
  it.each([
    ['import { x } from "@/lib/x";', "app/lib/x"],
    ['import { x } from "./x";', "app/trpc/__tests__/x"],
    ['import { x } from "../x";', "app/trpc/x"],
    ['import { x } from "../../lib/x";', "app/lib/x"],
    ['import { x } from "..";', "app/trpc"],
  ])("%s resolves against the importing file's folder to %s", (text, expected) => {
    expect(modulesOf(text)).toEqual([expected]);
  });

  it.each([['import { it } from "vitest";'], ['import { Effect } from "effect";'], ['import { it } from "@effect/vitest";']])(
    "a package import (%s) resolves to nothing, so a scoped package is not read as the @/ alias",
    (text) => {
      expect(modulesOf(text)).toEqual([]);
    },
  );

  it("a re-export, an export-all and a dynamic import each count as an import", () => {
    const text = 'export { a } from "./a";\nexport * from "./b";\nconst c = await import("./c");\nexport { c };\n';

    expect(modulesOf(text, "app/lib/index.ts")).toEqual(["app/lib/a", "app/lib/b", "app/lib/c"]);
  });

  it("a dynamic import of a computed specifier is skipped rather than guessed", () => {
    expect(modulesOf("const name = 'x';\nconst m = await import(name);\n")).toEqual([]);
  });

  it.each([
    ['import { x } from "../x.ts";', "app/trpc/x"],
    ['import { x } from "../x.tsx";', "app/trpc/x"],
    ['import { x } from "@/lib/x.js";', "app/lib/x"],
    ['import { x } from "../door.machine";', "app/trpc/door.machine"],
  ])("a code extension on %s is dropped, and a dotted name keeps its dots", (text, expected) => {
    expect(modulesOf(text)).toEqual([expected]);
  });
});

describe("withoutExtension", () => {
  it("drops only a trailing code extension", () => {
    expect([withoutExtension("app/a.ts"), withoutExtension("app/a.tsx"), withoutExtension("app/a.json"), withoutExtension("app/a.ts.bak")]).toEqual([
      "app/a",
      "app/a",
      "app/a.json",
      "app/a.ts.bak",
    ]);
  });
});

describe("importsFile", () => {
  it("accepts the folder as an import of its index.ts, and the index path itself", () => {
    expect(importsFile(sourceOf('import { x } from "..";', TEST_FILE), "app/trpc/index.ts")).toBe(true);
    expect(importsFile(sourceOf('import { x } from "@/trpc";', "app/lib/__tests__/x.test.ts"), "app/trpc/index.ts")).toBe(true);
    expect(importsFile(sourceOf('import { x } from "../index";', TEST_FILE), "app/trpc/index.ts")).toBe(true);
  });

  it.each([
    ['import { x } from "../";', TEST_FILE],
    ['import { x } from "./";', "app/trpc/index.test.ts"],
  ])("a folder import with a trailing slash (%s) counts as importing the folder's index.ts, the same as without one", (text, from) => {
    expect(importsFile(sourceOf(text, from), "app/trpc/index.ts")).toBe(true);
  });

  it("does not accept a folder import for a file that is not its index", () => {
    expect(importsFile(sourceOf('import { x } from "..";', TEST_FILE), "app/trpc/router.ts")).toBe(false);
  });

  it("rejects a file with the same base name in another folder", () => {
    const test = sourceOf('import { helper } from "@/other/helper";', "app/lib/__tests__/helper.test.ts");

    expect(importsFile(test, "app/lib/helper.ts")).toBe(false);
    expect(importsFile(test, "app/other/helper.ts")).toBe(true);
  });

  it("matches a .tsx target imported with no extension", () => {
    expect(importsFile(sourceOf('import { Button } from "../button";', "app/components/__tests__/button.test.tsx"), "app/components/button.tsx")).toBe(true);
  });
});
