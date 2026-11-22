import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { diskRepo } from "../../repo";
import { TEST_MAP_PATH } from "../../constants";
import { parseTestMap } from "../map";

const mapText = (entries: Record<string, string>[]): string => JSON.stringify({ entries });

const problemsOf = (text: string): string[] => {
  const parsed = parseTestMap(text);
  return Either.isLeft(parsed) ? parsed.left : [];
};

const classify = (entries: Record<string, string>[], path: string): string | undefined => {
  const parsed = parseTestMap(mapText(entries));
  return Either.isRight(parsed) ? parsed.right.classify(path)?.match : "did not parse";
};

describe("parseTestMap classify", () => {
  it("the first matching entry wins, so a narrow entry above a broad one decides and a broad one above hides it", () => {
    const narrow = { match: "app/lib/kinds.ts", kind: "declaration" };
    const broad = { match: "app/lib/**", kind: "unit" };

    expect(classify([narrow, broad], "app/lib/kinds.ts")).toBe("app/lib/kinds.ts");
    expect(classify([broad, narrow], "app/lib/kinds.ts")).toBe("app/lib/**");
    expect(classify([narrow, broad], "app/lib/helper.ts")).toBe("app/lib/**");
  });

  it("a path no entry matches classifies as undefined, not as the last entry", () => {
    expect(classify([{ match: "app/lib/**", kind: "unit" }], "app/hooks/use-x.ts")).toBeUndefined();
  });

  it("keeps the entries in file order with their test and reason", () => {
    const entries = [
      { match: "app/routes.ts", kind: "covered-by", test: "e2e/auth.spec.ts", reason: "The route table." },
      { match: "app/**", kind: "unit" },
    ];
    const parsed = parseTestMap(mapText(entries));

    expect(Either.isRight(parsed) ? parsed.right.entries : undefined).toEqual(entries);
  });
});

describe("parseTestMap problems", () => {
  it("an unknown kind is one short problem that names the entry by its match and lists the kinds, so the reader can fix it without the schema", () => {
    const problems = problemsOf(mapText([{ match: "app/lib/**", kind: "unit" }, { match: "app/x/**", kind: "vibes" }]));

    expect(problems).toEqual([
      'the entry for "app/x/**" has the kind "vibes"; the kinds are unit, machine, procedure, route, component, primitive, declaration, covered-by',
    ]);
  });

  it("an unknown key is a problem that points at that entry and names the key, so a typo like `tests` is not silently dropped", () => {
    const problems = problemsOf(mapText([{ match: "app/lib/**", kind: "unit", tests: "x.test.ts" }]));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/\[0\] +└─ .* +└─ \["tests"\] +└─ is unexpected/);
  });

  it("a match padded with spaces is a problem, since it would never equal a path", () => {
    expect(problemsOf(mapText([{ match: " app/lib/** ", kind: "unit" }]))).toHaveLength(1);
  });

  it.each([
    ["no test", { match: "app/routes.ts", kind: "covered-by", reason: "The route table." }],
    ["no reason", { match: "app/routes.ts", kind: "covered-by", test: "e2e/auth.spec.ts" }],
  ])("a covered-by entry with %s is a problem that names the entry by its match", (_label, entry) => {
    expect(problemsOf(mapText([entry]))).toEqual([
      'the entry for "app/routes.ts" is "covered-by" and needs both `test` (a test file\'s path) and `reason`',
    ]);
  });

  it.each([
    ["test", { match: "app/lib/**", kind: "unit", test: "app/lib/__tests__/x.test.ts" }],
    ["reason", { match: "app/lib/**", kind: "unit", reason: "Because." }],
  ])("an entry that is not covered-by and carries a %s is a problem that names the entry", (_label, entry) => {
    expect(problemsOf(mapText([entry]))).toEqual([
      'the entry for "app/lib/**" is "unit", so it takes no `test` or `reason`; only "covered-by" does',
    ]);
  });

  it("reports every bad entry, not only the first", () => {
    const problems = problemsOf(
      mapText([
        { match: "app/a/**", kind: "covered-by" },
        { match: "app/b/**", kind: "unit" },
        { match: "app/c/**", kind: "unit", test: "x.test.ts" },
      ])
    );

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('"app/a/**"');
    expect(problems[1]).toContain('"app/c/**"');
  });

  it.each([["{ entries: ["], [""], ["[]"], ['{ "entries": {} }']])("text that is not a map (%s) gives exactly one problem", (text) => {
    const problems = problemsOf(text);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^the map does not parse: /);
    expect(problems[0]).not.toContain("\n");
  });
});

describe("the committed map", () => {
  it("parses with no problems, so the rule runs on the real repo instead of stopping at the map", () => {
    const text = diskRepo(fileURLToPath(new URL("../../../../", import.meta.url))).read(TEST_MAP_PATH);

    expect(text).toBeDefined();
    expect(problemsOf(text ?? "")).toEqual([]);
    expect(Either.isRight(parseTestMap(text ?? ""))).toBe(true);
  });
});
