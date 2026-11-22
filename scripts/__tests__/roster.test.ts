import { describe, it, expect } from "vitest";
import { applyBlock, firstSentence, parseFrontmatter, renderBlock, run, toAgents, validate, END, START, type Deps } from "../roster";

const agent = (over: Record<string, string | null> = {}, name = "alpha"): string => {
  const fm: Record<string, string | null> = {
    name,
    description: "Does the thing. More detail here.",
    tools: "Read, Grep",
    model: "sonnet",
    effort: "medium",
    ...over,
  };
  const body = Object.entries(fm).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`);
  return ["---", ...body, "---", "", "Body."].join("\n");
};

const README = `# Sub-agents

Intro text.

${START}
old table
${END}

Outro text.
`;

function memDeps(files: Record<string, string>) {
  const disk = { ...files };
  const writes: string[] = [];
  const deps: Deps = {
    readFile: (p) => {
      if (!(p in disk)) throw new Error(`ENOENT ${p}`);
      return disk[p];
    },
    writeFile: (p, t) => {
      disk[p] = t;
      writes.push(p);
    },
    listDir: (p) => {
      const pre = `${p}/`;
      return Object.keys(disk).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map((k) => k.slice(pre.length));
    },
  };
  return { disk, writes, deps };
}

const A = "/r/.claude/agents";

describe("firstSentence", () => {
  it("cuts at the first '. ' so the table row is one sentence, not the whole paragraph", () => {
    expect(firstSentence("Grades a ticket. Used by the workflow. More.")).toBe("Grades a ticket");
  });
  it("cuts at ' Examples - ' when that comes before any period, so the example list never lands in the table", () => {
    expect(firstSentence('Reviews a diff against rules Examples - "review my branch". Read-only.')).toBe("Reviews a diff against rules");
  });
  it("cuts at the period when it comes before ' Examples - '", () => {
    expect(firstSentence('Writes tests. Examples - "write tests"')).toBe("Writes tests");
  });
  it("returns a description with no period whole instead of dropping it", () => {
    expect(firstSentence("Runs shell steps and reports output")).toBe("Runs shell steps and reports output");
  });
  it("drops a lone closing period so rows read the same whether or not the author ended with one", () => {
    expect(firstSentence("Runs shell steps.")).toBe("Runs shell steps");
  });
});

describe("parseFrontmatter", () => {
  it("returns null for a file with no opening ---, so validate can name it", () => {
    expect(parseFrontmatter("# Title\nname: x")).toBeNull();
  });
  it("keeps a colon inside the value (descriptions contain colons)", () => {
    expect(parseFrontmatter("---\ndescription: Does x: and y\n---\n")).toEqual({ description: "Does x: and y" });
  });
  it("ignores lines after the closing ---", () => {
    expect(parseFrontmatter("---\nname: a\n---\nmodel: opus\n")).toEqual({ name: "a" });
  });
});

describe("validate", () => {
  it("passes a complete agent", () => {
    expect(validate({ alpha: agent() })).toEqual([]);
  });
  it.each(["description", "tools"])("fails an agent with no %s, naming the file", (key) => {
    const p = validate({ alpha: agent({ [key]: null }) });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("alpha.md");
    expect(p[0]).toContain(key);
  });
  it("fails an agent with no name, naming the file", () => {
    const p = validate({ alpha: agent({ name: null }) });
    expect(p[0]).toMatch(/^alpha\.md: no `name`/);
  });
  it("fails when name differs from the file name: a workflow calls agents by name, so a mismatch breaks the call", () => {
    const p = validate({ alpha: agent({ name: "beta" }) });
    expect(p[0]).toMatch(/^alpha\.md: .*"beta".*must match/);
  });
  it("fails a missing model, naming the file", () => {
    const p = validate({ alpha: agent({ model: null }) });
    expect(p[0]).toMatch(/^alpha\.md: `model` is missing/);
  });
  it("fails a model outside opus, sonnet, haiku (a typo like 'sonet' would silently fall back)", () => {
    const p = validate({ alpha: agent({ model: "sonet" }) });
    expect(p[0]).toMatch(/^alpha\.md: `model` is "sonet"/);
  });
  it("fails a missing effort, naming the file", () => {
    const p = validate({ alpha: agent({ effort: null }) });
    expect(p[0]).toMatch(/^alpha\.md: `effort` is missing/);
  });
  it("fails an effort outside low, medium, high", () => {
    const p = validate({ alpha: agent({ effort: "max" }) });
    expect(p[0]).toMatch(/^alpha\.md: `effort` is "max"/);
  });
  it("names a file with no frontmatter at all", () => {
    expect(validate({ alpha: "# just prose" })[0]).toMatch(/^alpha\.md: no frontmatter/);
  });
  it("reports every bad file, not only the first", () => {
    const p = validate({ alpha: agent({ model: "x" }), beta: agent({ effort: "x" }, "beta") });
    expect(p.map((l) => l.split(":")[0])).toEqual(["alpha.md", "beta.md"]);
  });
});

describe("renderBlock", () => {
  const block = (files: Record<string, string>) => renderBlock(toAgents(files));

  it("escapes a | in a description so it does not split the row into extra columns", () => {
    const b = block({ alpha: agent({ description: "Reads a|b files. Then more." }) });
    expect(b).toContain("| Reads a\\|b files |");
  });
  it("sorts rows by name whatever order the files arrive in", () => {
    const b = block({ zed: agent({}, "zed"), alpha: agent() });
    expect(b.indexOf("[`alpha`]")).toBeLessThan(b.indexOf("[`zed`]"));
  });
  it("writes name, link, model, effort and sentence in the row", () => {
    expect(block({ alpha: agent() })).toContain("| [`alpha`](alpha.md) | sonnet | medium | Does the thing |");
  });
  it("counts agents per model and leaves out a model with none", () => {
    const b = block({ a: agent({ model: "opus" }, "a"), b: agent({}, "b"), c: agent({}, "c") });
    expect(b).toContain("3 agents: 1 opus, 2 sonnet");
    expect(b).not.toContain("haiku");
  });
  it("says in the block that it is generated and how to regenerate it", () => {
    expect(block({ alpha: agent() })).toContain("bun scripts/roster.ts write");
  });
});

describe("applyBlock", () => {
  it("leaves text outside the markers byte for byte", () => {
    const out = applyBlock(README, `${START}\nnew\n${END}`);
    expect(out.startsWith("# Sub-agents\n\nIntro text.\n\n")).toBe(true);
    expect(out.endsWith("\n\nOutro text.\n")).toBe(true);
    expect(out).toContain("new");
    expect(out).not.toContain("old table");
  });
  it("throws on a README with no markers, instead of appending a second table", () => {
    expect(() => applyBlock("# Sub-agents\n", "x")).toThrow(/roster:start/);
  });
  it("throws on markers in the wrong order", () => {
    expect(() => applyBlock(`${END}\n${START}\n`, "x")).toThrow(/comes before/);
  });
  it("throws on a repeated marker, so one stale copy is not left behind", () => {
    expect(() => applyBlock(`${START}\n${END}\n${START}\n${END}\n`, "x")).toThrow(/once/);
  });
});

describe("run", () => {
  const files = () => ({
    [`${A}/alpha.md`]: agent(),
    [`${A}/beta.md`]: agent({ model: "opus", effort: "high" }, "beta"),
    [`${A}/README.md`]: README,
  });

  it("does not make README.md a row", () => {
    const { disk, deps } = memDeps(files());
    expect(run(["write"], "/r", deps).code).toBe(0);
    const out = disk[`${A}/README.md`];
    expect(out).not.toContain("[`README`]");
    expect(out).toContain("2 agents: 1 opus, 1 sonnet");
  });
  it("check fails on a stale table and says how to fix it; write fixes it; check then passes", () => {
    const { deps } = memDeps(files());
    const stale = run(["check"], "/r", deps);
    expect(stale.code).toBe(1);
    expect(stale.stderr.join("\n")).toContain("bun scripts/roster.ts write");
    expect(run(["write"], "/r", deps).code).toBe(0);
    const fresh = run(["check"], "/r", deps);
    expect(fresh.code).toBe(0);
    expect(fresh.stdout).toHaveLength(1);
  });
  it("check fails when an agent's model changes after the table was written (the drift this script exists to stop)", () => {
    const { disk, deps } = memDeps(files());
    run(["write"], "/r", deps);
    disk[`${A}/alpha.md`] = agent({ model: "opus", effort: "high" });
    expect(run(["check"], "/r", deps).code).toBe(1);
  });
  it("write leaves the text outside the markers untouched", () => {
    const { disk, deps } = memDeps(files());
    run(["write"], "/r", deps);
    const out = disk[`${A}/README.md`];
    expect(out.startsWith("# Sub-agents\n\nIntro text.\n\n")).toBe(true);
    expect(out.endsWith("\n\nOutro text.\n")).toBe(true);
  });
  it("write twice changes nothing the second time", () => {
    const { writes, deps } = memDeps(files());
    run(["write"], "/r", deps);
    run(["write"], "/r", deps);
    expect(writes).toHaveLength(1);
  });
  it("errors on a README with no markers and writes nothing", () => {
    const f = files();
    f[`${A}/README.md`] = "# Sub-agents\n";
    const { disk, writes, deps } = memDeps(f);
    const o = run(["write"], "/r", deps);
    expect(o.code).toBe(1);
    expect(o.stderr.join("\n")).toContain("roster:start");
    expect(writes).toEqual([]);
    expect(disk[`${A}/README.md`]).toBe("# Sub-agents\n");
  });
  it("fails check and write with the file name when an agent has a bad model, and writes nothing", () => {
    const f = files();
    f[`${A}/beta.md`] = agent({ model: "gpt" }, "beta");
    const { writes, deps } = memDeps(f);
    for (const verb of ["check", "write"]) {
      const o = run([verb], "/r", deps);
      expect(o.code).toBe(1);
      expect(o.stderr.join("\n")).toContain("beta.md");
    }
    expect(writes).toEqual([]);
  });
  it("rejects an unknown verb", () => {
    expect(run(["frob"], "/r", memDeps(files()).deps).code).toBe(1);
  });
});
