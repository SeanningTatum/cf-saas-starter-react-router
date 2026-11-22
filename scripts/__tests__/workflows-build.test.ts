import { describe, it, expect } from "vitest";
import { buildWorkflow, drift, run, sourceNames, stripLib, type Deps } from "../workflows";

const LIB = `/** doc */
export const STR = { type: "string" };
export function twice(fn) {
  return fn();
}
export async function asyncHelper() {}
const internal = 1;
`;

const SRC = `export const meta = {
  name: "demo",
};

// header comment
// @lib
const { x } = twice(() => 1);
return { x };
`;

describe("buildWorkflow", () => {
  const out = buildWorkflow("demo", SRC, LIB);
  const lines = out.split("\n");

  it("keeps `export const meta = ` as the very first text: the runtime refuses a script that does not begin with it", () => {
    expect(out.startsWith("export const meta = {")).toBe(true);
  });

  it("puts the GENERATED pointer straight after the meta literal and not before it", () => {
    const end = lines.indexOf("};");
    expect(lines[end + 1]).toBe("// GENERATED, edit .claude/workflow-src/demo.js");
    expect(lines.indexOf("// GENERATED, edit .claude/workflow-src/demo.js")).toBe(end + 1);
  });

  it("replaces the `// @lib` line with banner, library and end marker, in that order, and leaves no marker behind", () => {
    expect(out).not.toMatch(/^\/\/ @lib$/m);
    const banner = lines.findIndex((l) =>
      l.startsWith(
        "// ---- generated from .claude/workflow-src/lib.js by scripts/workflows.ts; edit the source, then run `bun scripts/workflows.ts build`",
      ),
    );
    const end = lines.indexOf("// ---- end of .claude/workflow-src/lib.js ----");
    expect(banner).toBeGreaterThan(lines.indexOf("// header comment"));
    expect(end).toBeGreaterThan(banner);
    expect(lines[end + 1]).toBe("const { x } = twice(() => 1);");
  });

  it("strips `export ` from every library declaration: a script body with `export function` does not parse", () => {
    expect(out).toContain('const STR = { type: "string" };');
    expect(out).toContain("function twice(fn) {");
    expect(out).toContain("async function asyncHelper() {}");
    expect(out.split("\n").filter((l) => /^export /.test(l))).toEqual(["export const meta = {"]);
  });

  it("is a pure function of its inputs: the same sources build to the same text, so `check` can compare", () => {
    expect(buildWorkflow("demo", SRC, LIB)).toBe(out);
  });

  it("refuses a source that does not begin with the meta literal", () => {
    expect(() => buildWorkflow("demo", `// hello\n${SRC}`, LIB)).toThrow(
      /must begin with "export const meta = "/,
    );
  });

  it("refuses a source with no `// @lib` line, or with two: the library would be missing or defined twice", () => {
    expect(() => buildWorkflow("demo", SRC.replace("// @lib\n", ""), LIB)).toThrow(
      /exactly one "\/\/ @lib" line, found 0/,
    );
    expect(() =>
      buildWorkflow("demo", SRC.replace("// @lib\n", "// @lib\n// @lib\n"), LIB),
    ).toThrow(/found 2/);
  });

  it("refuses an `// @lib` line placed before the end of meta, which would paste the library inside the literal", () => {
    const early = `export const meta = {\n  // @lib\n  name: "demo",\n};\nreturn 1;\n`;
    expect(() => buildWorkflow("demo", early, LIB)).toThrow(/after the meta literal/);
  });

  it("refuses a library that imports: a workflow script has no import", () => {
    expect(() => buildWorkflow("demo", SRC, `import { a } from "./a.js";\n${LIB}`)).toThrow(
      /must not import/,
    );
    expect(() => buildWorkflow("demo", SRC, `${LIB}const m = await import('x');\n`)).toThrow(
      /must not import/,
    );
  });
});

describe("stripLib", () => {
  it("refuses export forms it cannot strip", () => {
    expect(() => stripLib("export default 1;\n")).toThrow(/only "export const/);
    expect(() => stripLib("const a = 1;\nexport { a };\n")).toThrow(/only "export const/);
  });

  it("does not touch the word export inside a string or a comment", () => {
    expect(stripLib('export const a = "export const b";\n// export const c\n')).toBe(
      'const a = "export const b";\n// export const c',
    );
  });
});

describe("sourceNames", () => {
  it("takes every .js file but lib.js, sorted, and ignores other files", () => {
    expect(sourceNames(["ship.js", "lib.js", "README.md", "plan.js", "notes.json"])).toEqual([
      "plan",
      "ship",
    ]);
  });
});

describe("drift", () => {
  const sources = { a: SRC.replace("demo", "a"), b: SRC.replace("demo", "b") };
  const good = { a: buildWorkflow("a", sources.a, LIB), b: buildWorkflow("b", sources.b, LIB) };

  it("finds nothing when every built file matches its source", () => {
    expect(drift(sources, good, LIB)).toEqual([]);
  });

  it("flags a hand-edited built file, naming it: the edit would be lost at the next build", () => {
    const p = drift(sources, { ...good, a: `${good.a}// hand edit\n` }, LIB);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^a\.js: differs from what/);
  });

  it("flags every built file when the library changed and nobody rebuilt", () => {
    expect(drift(sources, good, `${LIB}export const NEW = 1;\n`)).toHaveLength(2);
  });

  it("flags a source with no built file", () => {
    expect(drift(sources, { a: good.a }, LIB)).toEqual([
      "b.js: no built file for .claude/workflow-src/b.js",
    ]);
  });

  it("flags a built file with no source (a renamed or deleted workflow left behind)", () => {
    const p = drift(sources, { ...good, old: "x" }, LIB);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^old\.js: no source \.claude\/workflow-src\/old\.js/);
  });
});

/** An in-memory file system keyed by absolute path. */
function memfs(files: Record<string, string>) {
  const written: Record<string, string> = {};
  const made: string[] = [];
  const deps: Deps = {
    readFile: (p) => {
      const t = written[p] ?? files[p];
      if (t === undefined) throw new Error(`ENOENT: ${p}`);
      return t;
    },
    writeFile: (p, t) => {
      written[p] = t;
    },
    listDir: (p) => {
      const prefix = p.endsWith("/") ? p : `${p}/`;
      return [
        ...new Set(
          [...Object.keys(files), ...Object.keys(written)]
            .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
            .map((k) => k.slice(prefix.length)),
        ),
      ];
    },
    mkdirp: (p) => void made.push(p),
  };
  return { deps, written, made };
}

const ROOT = "/repo";
const tree = (extra: Record<string, string> = {}) => ({
  "/repo/.claude/workflow-src/lib.js": LIB,
  "/repo/.claude/workflow-src/demo.js": SRC,
  ...extra,
});

describe("run build", () => {
  it("writes <out>/<name>.js for each source but lib.js, creates the directory, and prints one line per file", () => {
    const { deps, written, made } = memfs(tree());
    const r = run(["build"], ROOT, deps);
    expect(r.code).toBe(0);
    expect(Object.keys(written)).toEqual(["/repo/.claude/workflows/demo.js"]);
    expect(written["/repo/.claude/workflows/demo.js"]).toBe(buildWorkflow("demo", SRC, LIB));
    expect(made).toEqual(["/repo/.claude/workflows"]);
    expect(r.stdout).toEqual([
      `built .claude/workflows/demo.js (${buildWorkflow("demo", SRC, LIB).split("\n").length} lines)`,
    ]);
  });

  it("builds into --out instead, leaving .claude/workflows alone: the test lanes read those files while a build runs elsewhere", () => {
    const { deps, written } = memfs(tree());
    expect(run(["build", "--out", "/scratch/out"], ROOT, deps).code).toBe(0);
    expect(Object.keys(written)).toEqual(["/scratch/out/demo.js"]);
  });

  it("writes nothing when any source fails to build: no half-built directory", () => {
    const { deps, written } = memfs(tree({ "/repo/.claude/workflow-src/bad.js": "// no meta\n" }));
    const r = run(["build"], ROOT, deps);
    expect(r.code).toBe(1);
    expect(r.stderr[0]).toMatch(/^bad: a workflow source must begin with/);
    expect(written).toEqual({});
  });

  it("exits 1 with a usage line for a missing verb, an unknown verb, an unknown flag or a bare --out", () => {
    const { deps } = memfs(tree());
    for (const argv of [
      [],
      ["bild"],
      ["build", "--into", "x"],
      ["build", "--out"],
      ["build", "--out", "--x"],
    ]) {
      const r = run(argv, ROOT, deps);
      expect(r.code, argv.join(" ")).toBe(1);
      expect(r.stderr.join("\n")).toContain("usage: bun scripts/workflows.ts build|check");
    }
  });

  it("exits 1 when the source directory holds no workflow, or lib.js is gone", () => {
    expect(run(["build"], ROOT, memfs({}).deps).code).toBe(1);
    const noLib = memfs({ "/repo/.claude/workflow-src/demo.js": SRC });
    const r = run(["build"], ROOT, noLib.deps);
    expect(r.code).toBe(1);
    expect(r.stderr[0]).toContain("lib.js");
  });
});

describe("run check", () => {
  const built = buildWorkflow("demo", SRC, LIB);

  it("exits 0 with one line when every built file matches", () => {
    const { deps } = memfs(tree({ "/repo/.claude/workflows/demo.js": built }));
    const r = run(["check"], ROOT, deps);
    expect(r.code).toBe(0);
    expect(r.stdout).toEqual(["workflows: 1 built scripts match their sources"]);
  });

  it("exits 1, naming the drifted file and saying how to fix it, when someone edited the built script", () => {
    const { deps } = memfs(tree({ "/repo/.claude/workflows/demo.js": `${built}// edit\n` }));
    const r = run(["check"], ROOT, deps);
    expect(r.code).toBe(1);
    expect(r.stderr[0]).toContain(".claude/workflows/demo.js: differs");
    expect(r.stderr.at(-1)).toContain("run `bun scripts/workflows.ts build`");
    expect(r.stderr.at(-1)).toContain("edit .claude/workflow-src/");
  });

  it("exits 1 for a source with no built file, and for a built file with no source", () => {
    const missing = run(["check"], ROOT, memfs(tree()).deps);
    expect(missing.code).toBe(1);
    expect(missing.stderr[0]).toContain("demo.js: no built file");
    const orphan = run(
      ["check"],
      ROOT,
      memfs(
        tree({ "/repo/.claude/workflows/demo.js": built, "/repo/.claude/workflows/gone.js": "x" }),
      ).deps,
    );
    expect(orphan.code).toBe(1);
    expect(orphan.stderr[0]).toContain("gone.js: no source");
  });

  it("checks --out when given, so a scratch build can be verified", () => {
    const { deps } = memfs(tree({ "/scratch/demo.js": built }));
    expect(run(["check", "--out", "/scratch"], ROOT, deps).code).toBe(0);
  });

  it("exits 1 with the build error, not a crash, when a source cannot build", () => {
    const { deps } = memfs(
      tree({
        "/repo/.claude/workflows/demo.js": built,
        "/repo/.claude/workflow-src/demo.js": SRC.replace("// @lib\n", ""),
      }),
    );
    const r = run(["check"], ROOT, deps);
    expect(r.code).toBe(1);
    expect(r.stderr[0]).toContain('exactly one "// @lib" line');
  });
});
