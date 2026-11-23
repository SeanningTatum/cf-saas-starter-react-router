import { describe, expect, it } from "vitest";
import { sourceOf } from "../../__tests__/fixtures";
import { usesFile } from "../uses";

const SUBJECT = "app/lib/helper.ts";
const IMPORT = 'import { helper } from "../helper";\n';
const uses = (text: string, path = "app/lib/__tests__/helper.test.ts"): boolean => usesFile(sourceOf(text, path), SUBJECT);

describe("usesFile: what counts as exercising the file", () => {
  it.each([
    [`${IMPORT}helper(1);`, "a call"],
    [`${IMPORT}new helper();`, "a construction"],
    [`${IMPORT}helper\`x\`;`, "a tagged template"],
    [`${IMPORT}[1].map(helper);`, "a value passed by reference to the code under test"],
    [`${IMPORT}expect(helper).toBe(2);`, "a value compared by an assertion, as a test of a computed constant does"],
    [`${IMPORT}expect(helper.flags).toContain("g");`, "a property of the export read inside an assertion"],
    [`${IMPORT}for (const p of [helper]) expect(p).toBe(1);`, "a value placed in a list the test walks"],
    [`${IMPORT}run({ handler: helper });`, "a value handed over as an option"],
    [`${IMPORT}run({ helper });`, "a shorthand property, which reads the binding"],
    [`${IMPORT}render(<Shell>{helper}</Shell>);`, "a value placed in JSX"],
    ['import { Helper } from "../helper";\nrender(<Helper />);', "a component rendered by its tag"],
    ['import * as subject from "../helper";\nsubject.helper(1);', "a namespace import called through a property"],
    ['import def from "../helper";\ndef();', "a default import"],
    ['import { helper as h } from "../helper";\nh(1);', "a renamed import called by its local name"],
    ['const { helper } = await import("../helper");', "a dynamic import whose result is kept"],
    [
      'vi.mock("../helper", async (importOriginal) => ({ ...(await importOriginal()), extra: 1 }));\nimport { helper } from "../helper";\nhelper(1);',
      "a partial mock that keeps the real module",
    ],
  ])("%s counts: %s", (text) => {
    expect(uses(text, text.includes("<") ? "app/lib/__tests__/helper.test.tsx" : undefined)).toBe(true);
  });
});

describe("usesFile: what does not count", () => {
  it.each([
    [IMPORT, "an import never read"],
    ['import "../helper";', "a side-effect import"],
    [`${IMPORT}type R = ReturnType<typeof helper>;`, "a read inside a type"],
    [`${IMPORT}const o = { helper: 1 };\no.helper;`, "a property that only shares the name"],
    ['import { type helper } from "../helper";\nconst x: helper = 1;', "a type-only specifier"],
    ['import { helper } from "@/other/helper";\nhelper(1);', "a call to a same-named export of another file"],
    [`${IMPORT}expect(helper).toBeDefined();`, "an assertion that only checks the export exists"],
    [`${IMPORT}expect(helper).not.toBeUndefined();`, "a negated presence check"],
    [`${IMPORT}expect(helper).toBeTypeOf("function");`, "an assertion on the export's type"],
    [`${IMPORT}assert(helper);`, "a bare assert on the export"],
    [`${IMPORT}typeof helper;\nvoid helper;`, "typeof and void"],
    [`${IMPORT}const run = (helper: number) => helper;`, "a parameter that reuses the name"],
    ['vi.mock("../helper");\nimport { helper } from "../helper";\nhelper(1);', "an automocked file: the call reaches the mock"],
    ['vi.mock("../helper", () => ({ helper: vi.fn() }));\nimport { helper } from "../helper";\nhelper(1);', "a file replaced by a factory"],
    ['await import("../helper");', "a dynamic import whose result is thrown away"],
  ])("%s does not count: %s", (text) => {
    expect(uses(text)).toBe(false);
  });
});

describe("usesFile on an index file", () => {
  it("accepts an import of the folder for its index.ts", () => {
    expect(usesFile(sourceOf('import { x } from "..";\nx();', "app/trpc/__tests__/index.test.ts"), "app/trpc/index.ts")).toBe(true);
  });
});
