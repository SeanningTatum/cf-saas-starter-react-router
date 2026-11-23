import { describe, expect, it } from "vitest";
import { commentBody, commentsIn } from "../comments";
import { sourceOf } from "./fixtures";

type Placed = Array<[number, string]>;

const placed = (code: string, path = "app/a.ts"): Placed => commentsIn(sourceOf(code, path)).map((comment) => [comment.line, comment.text]);

const inTsx = (code: string): Placed => placed(code, "app/a.tsx");

describe("commentsIn", () => {
  it.each<[string, string, Placed]>([
    ["a line comment", "// one\nexport const a = 1;\n", [[1, "// one"]]],
    ["a block comment", "/* one */\nexport const a = 1;\n", [[1, "/* one */"]]],
    [
      "a JSDoc block, which the AST also holds as a JSDoc node",
      "/** Adds one. */\nexport function f(a: number) {\n  return a + 1;\n}\n",
      [[1, "/** Adds one. */"]],
    ],
    ["a comment after code on the same line", "export const a = 1; // one\n", [[1, "// one"]]],
    ["a comment after the last statement, before the end of the file", "export const a = 1;\n// the end\n", [[2, "// the end"]]],
    ["a comment that is the whole file", "// alone\n", [[1, "// alone"]]],
    ["a comment between a function's parameters", "export function f(a: number, /* b next */ b: number) {\n  return a + b;\n}\n", [[1, "/* b next */"]]],
    ["a comment inside a type literal", 'type T = {\n  // the id\n  id: string;\n};\nexport const t: T = { id: "x" };\n', [[2, "// the id"]]],
    ["a comment in an empty function body", "export function f() {\n  /* nothing */\n}\n", [[2, "/* nothing */"]]],
    [
      "a block comment over several lines, on the line it opens",
      "export const a = 1;\n/*\n  one\n  two\n*/\nexport const b = 2;\n",
      [[2, "/*\n  one\n  two\n*/"]],
    ],
    [
      "two comments on consecutive lines as two entries",
      "// first\n// second\nexport const a = 1;\n",
      [
        [1, "// first"],
        [2, "// second"],
      ],
    ],
  ])("finds %s", (_kind, code, expected) => {
    expect(placed(code)).toEqual(expected);
  });

  it("returns every comment once and in file order, so a trailing comment is not also the next token's leading comment", () => {
    const code = [
      "/** Doc. */",
      "export function f(a: number, /* b */ b: number): number { // opens",
      "  // body",
      "  return a + b; /* sum */ // twice",
      "}",
      "// end",
    ].join("\n");

    expect(placed(code)).toEqual([
      [1, "/** Doc. */"],
      [2, "/* b */"],
      [2, "// opens"],
      [3, "// body"],
      [4, "/* sum */"],
      [4, "// twice"],
      [6, "// end"],
    ]);
  });

  it("fills pos and body, so a caller can place the comment and read it without its markers", () => {
    const code = "export const a = 1; /* why */\n";

    expect(commentsIn(sourceOf(code))).toEqual([{ pos: code.indexOf("/*"), line: 1, endLine: 1, text: "/* why */", body: "why" }]);
  });

  it("gives a comment over several lines the line it ends on, so a caller knows which line of code follows it", () => {
    const [comment] = commentsIn(sourceOf("/* one\n   two\n   three */\nexport const a = 1;\n"));

    expect(comment).toMatchObject({ line: 1, endLine: 3 });
  });

  it("finds no comment in a string, a template or a regex that holds // or /*", () => {
    const code = [
      'export const a = "http://x /* y */";',
      "export const b = '// z';",
      "export const c = `// a ${a} /* b */ ${b} // c`;",
      "export const d = /\\/\\/|\\/\\*/;",
      "export const e = `/* plain */`;",
    ].join("\n");

    expect(placed(code)).toEqual([]);
  });

  it("finds a comment on either side of the value inside a template's ${}", () => {
    expect(placed("export const a = `x ${ /* here */ value /* there */ } y`;\n")).toEqual([
      [1, "/* here */"],
      [1, "/* there */"],
    ]);
  });

  it.each<[string, string, Placed]>([
    ["a shebang line is not a comment", "#!/usr/bin/env bun\nexport const a = 1;\n", []],
    ["a comment on line 2 under a shebang is found", "#!/usr/bin/env bun\n// does the job\nexport const a = 1;\n", [[2, "// does the job"]]],
    ["a comment that ends a file of only a shebang is found", "#!/usr/bin/env bun\n// only\n", [[2, "// only"]]],
  ])("%s", (_name, code, expected) => {
    expect(placed(code)).toEqual(expected);
  });
});

describe("commentsIn on JSX", () => {
  it.each<[string, string, Placed]>([
    ["on one line", "export const a = <div>{/* note */}</div>;\n", [[1, "/* note */"]]],
    ["spread over lines", "export const a = (\n  <div>\n    {/*\n      note\n    */}\n  </div>\n);\n", [[3, "/*\n      note\n    */"]]],
  ])("finds a {/* */} comment %s", (_shape, code, expected) => {
    expect(inTsx(code)).toEqual(expected);
  });

  it.each([
    ["after an opening tag", "export const a = <p>// see http://x.com /* a */ comment</p>;\n"],
    ["after an opening tag with attributes", 'export const a = <p className="x"> /* not */ // a comment</p>;\n'],
    ["after an opening fragment", "export const a = <>// not /* a */ comment</>;\n"],
    ["after a self-closing child", "export const a = <p><br />// not /* a */ comment</p>;\n"],
    ["after a {expr} child", "export const a = <p>{name} // not /* a */ comment</p>;\n"],
    ["after a closing child tag", "export const a = <p><b>x</b> // not /* a */ comment</p>;\n"],
    ["after a closing child tag inside a fragment", "export const a = <><b>x</b> // not /* a */ comment</>;\n"],
    ["after a generic component's opening tag", "export const a = <List<string>>// not /* a */ comment</List>;\n"],
    ["on its own line between children", "export const a = (\n  <p>\n    // not a comment\n    <b>x</b>\n  </p>\n);\n"],
  ])("JSX text %s that holds // or /* */ is not a comment", (_where, code) => {
    expect(inTsx(code)).toEqual([]);
  });

  it.each<[string, string, Placed]>([
    ["inside an attribute expression", "export const a = <a href={/* x */ url}>link</a>;\n", [[1, "/* x */"]]],
    ["between attributes", "export const a = (\n  <a\n    // the target\n    href={url}\n  >\n    link\n  </a>\n);\n", [[3, "// the target"]]],
    ["after a self-closing element that is not inside another", "export function F() {\n  return <div />; // done\n}\n", [[2, "// done"]]],
    ["right after a closing tag that is not inside another", "export const a = <p>x</p> // done\n", [[1, "// done"]]],
    ["after an element inside a {} child", "export const a = <p>{ok && <b>x</b> /* only when ok */}</p>;\n", [[1, "/* only when ok */"]]],
  ])("finds a comment %s", (_where, code, expected) => {
    expect(inTsx(code)).toEqual(expected);
  });
});

describe("commentBody", () => {
  it.each([
    ["// a line", "a line"],
    ["///  three slashes ", "three slashes"],
    ["/* a block */", "a block"],
    ["/** a doc */", "a doc"],
    ["/*tight*/", "tight"],
    ["/* extra stars **/", "extra stars"],
    ["/* */", ""],
  ])("strips the markers of %j and trims to %j", (text, body) => {
    expect(commentBody(text)).toBe(body);
  });
});
