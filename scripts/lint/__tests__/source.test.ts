import { describe, expect, it } from "vitest";
import { isOwnShippedSource, isShippedSource, isSourcePath, lineOf } from "../source";
import { sourceOf } from "./fixtures";

describe("path predicates", () => {
  it.each([
    ["app/lib/x.ts", true, true, true],
    ["app/routes/x.tsx", true, true, true],
    ["workers/app.ts", true, true, true],
    ["app/lib/__tests__/x.ts", true, false, false],
    ["app/lib/x.test.ts", true, false, false],
    ["app/components/x.test.tsx", true, false, false],
    ["app/services/database.test-layer.ts", true, false, false],
    ["app/components/ui/button.tsx", true, true, false],
    ["scripts/x.ts", true, false, false],
    ["application/x.ts", true, false, false],
    ["app/data.json", false, false, false],
    ["app/x.tsx.bak", false, false, false],
  ])("%s: source %s, shipped %s, own %s", (path, source, shipped, own) => {
    expect([isSourcePath(path), isShippedSource(path), isOwnShippedSource(path)]).toEqual([source, shipped, own]);
  });
});

describe("lineOf", () => {
  it("gives the 1-based line where the node's code starts, not where its leading comments start", () => {
    const { ast } = sourceOf("// a comment\n\nconst x = 1;");
    const [statement] = ast.statements;

    expect(statement && lineOf(ast, statement)).toBe(3);
  });
});
