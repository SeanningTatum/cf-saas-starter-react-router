import { describe, it, expect } from "vitest";
import { run, parseFields, mergeRecord, updateIndex, closestSlugs, type Deps } from "../memory";

const DIR = "/store";
const MEM = "/auto/MEMORY.md";

/** An in-memory store. `today` can move between calls. */
function store(files: Record<string, string> = {}, today = "2026-11-22") {
  const fs = new Map(Object.entries(files));
  const writes: string[] = [];
  const state = { today };
  const deps: Deps = {
    dir: () => DIR,
    memoryIndex: () => MEM,
    memoryLink: () => "features/INDEX.md",
    read: (p) => fs.get(p) ?? null,
    write: (p, t) => {
      writes.push(p);
      fs.set(p, t);
    },
    list: (d) => [...fs.keys()].filter((k) => k.startsWith(`${d}/`)).map((k) => k.slice(d.length + 1)),
    today: () => state.today,
  };
  const rec = (slug: string, input: string) => run(["record", slug], input, deps);
  const file = (slug: string) => fs.get(`${DIR}/${slug}.md`) ?? "";
  return { fs, deps, writes, state, rec, file };
}

const bullets = (text: string, heading: string) => {
  const m = new RegExp(`## ${heading}\\n([\\s\\S]*?)(\\n\\n## |\\n*$)`).exec(text);
  return (m?.[1] ?? "").split("\n").filter(Boolean);
};

describe("parseFields", () => {
  it("takes only the first colon as the split: a value that looks like `todo: x` stays inside its own field", () => {
    const r = parseFields("log: todo: fix it\nlink: PR: https://x/pull/1");
    expect(r).toEqual({ fields: { log: ["todo: fix it"], link: ["PR: https://x/pull/1"] } });
  });

  it.each([
    ["an unknown key", "colour: red"],
    ["a bad status", "status: finished"],
    ["a line with no key", "just words"],
    ["no field at all", "\n  \n"],
    ["only empty values", "log:\ntodo:  "],
    ["a bad issue", "issue: soon"],
  ])("refuses %s", (_, input) => {
    expect(parseFields(input)).toHaveProperty("error");
  });

  it("turns a bare number into #n, so an INDEX line never carries a bare 58", () => {
    expect(parseFields("issue: 58")).toEqual({ fields: { issue: ["#58"] } });
  });
});

describe("record: bad input writes nothing", () => {
  it("exits 2 and touches no file for an unknown key, even when other lines are fine: one typo must not half-merge", () => {
    const s = store();
    const r = s.rec("demo", "log: hello\ncolour: red");
    expect(r.code).toBe(2);
    expect(s.writes).toEqual([]);
  });

  it.each([["Not_Kebab"], ["two--dashes"], ["a/b"], ["../x"]])("refuses the slug %j", (slug) => {
    const s = store();
    expect(s.rec(slug, "log: x").code).toBe(2);
    expect(s.writes).toEqual([]);
  });
});

describe("record: decisions", () => {
  it("does not add the same decision twice, so a resumed workflow replaying its record keeps one line", () => {
    const s = store();
    s.rec("demo", "decision: use D1 — fits Workers — user in chat");
    s.state.today = "2026-11-25";
    s.rec("demo", "decision: use D1 — fits Workers — user in chat");
    expect(bullets(s.file("demo"), "Decisions")).toEqual(["- 2026-11-22 — use D1 — fits Workers — user in chat"]);
  });

  it("treats a decision the old agent marked superseded as the same text, not a new one", () => {
    const old = "---\nfeature: demo\nstatus: in-progress\nissue: none\nupdated: 2026-01-01\n---\n\n## Decisions\n- 2026-01-01 — use KV (superseded 2026-02-01) — cheap — chat\n";
    const m = mergeRecord(old, "demo", { decision: ["use KV — cheap — chat"] }, "2026-11-22");
    expect(m.text.match(/use KV/g)).toHaveLength(1);
  });
});

describe("record: todos", () => {
  it("done ticks the open todo in place and does not add a second line", () => {
    const s = store();
    s.rec("demo", "todo: write tests\ntodo: ship it");
    s.rec("demo", "done:   Write Tests ");
    expect(bullets(s.file("demo"), "Todo")).toEqual(["- [x] write tests (2026-11-22)", "- [ ] ship it"]);
  });

  it("done adds an item ticked when no todo matches, and adds it only once", () => {
    const s = store();
    s.rec("demo", "done: cut the release");
    s.rec("demo", "done: cut the release");
    expect(bullets(s.file("demo"), "Todo")).toEqual(["- [x] cut the release (2026-11-22)"]);
  });

  it("a todo already ticked is not added again as open", () => {
    const s = store();
    s.rec("demo", "done: cut the release");
    s.rec("demo", "todo: cut the release");
    expect(bullets(s.file("demo"), "Todo")).toHaveLength(1);
  });

  it("drops ticked todos older than 30 days and keeps younger ones and open ones", () => {
    const old =
      "---\nfeature: demo\nstatus: in-progress\nissue: none\nupdated: 2026-09-01\n---\n\n## Todo\n- [x] ancient (2026-10-01)\n- [x] edge (2026-10-23)\n- [x] recent (2026-11-10)\n- [ ] open one\n";
    const m = mergeRecord(old, "demo", { log: ["tick"] }, "2026-11-22");
    // 2026-10-01 is 52 days back and goes; 2026-10-23 is 30 days back and stays.
    expect(bullets(m.text, "Todo")).toEqual(["- [x] edge (2026-10-23)", "- [x] recent (2026-11-10)", "- [ ] open one"]);
  });
});

describe("record: log", () => {
  it("folds the eleventh entry into one `- earlier:` line and keeps the newest ten, newest first", () => {
    const s = store();
    for (let i = 1; i <= 11; i++) s.rec("demo", `log: step ${i}`);
    const log = bullets(s.file("demo"), "Log");
    expect(log).toHaveLength(11);
    expect(log[0]).toBe("- 2026-11-22 — step 11");
    expect(log[9]).toBe("- 2026-11-22 — step 2");
    expect(log[10]).toBe("- earlier: 2026-11-22 step 1");
  });

  it("a later fold adds to the same earlier line instead of starting a second one", () => {
    const s = store();
    for (let i = 1; i <= 12; i++) s.rec("demo", `log: step ${i}`);
    const earlier = bullets(s.file("demo"), "Log").filter((l) => l.startsWith("- earlier:"));
    expect(earlier).toEqual(["- earlier: 2026-11-22 step 2; 2026-11-22 step 1"]);
  });

  it("makes ONE entry from log, stopped, waiting and next, leaving absent parts out", () => {
    const m = mergeRecord(null, "demo", { log: ["built lane A"], stopped: ["review"], next: ["merge"] }, "2026-11-22");
    expect(bullets(m.text, "Log")).toEqual(["- 2026-11-22 — built lane A — stopped at: review — next: merge"]);
  });
});

describe("record: context", () => {
  it("never overwrites a written Context", () => {
    const s = store();
    s.rec("demo", "context: first words");
    const r = s.rec("demo", "context: second words");
    expect(s.file("demo")).toContain("first words");
    expect(s.file("demo")).not.toContain("second words");
    expect(r.out).toContain("context kept");
  });

  it("writes Context over the untouched template", () => {
    const s = store();
    s.rec("demo", "log: made");
    s.rec("demo", "context: a real context");
    expect(s.file("demo")).toContain("a real context");
    expect(s.file("demo")).not.toContain("Three to six lines");
  });
});

describe("record: hand-written files", () => {
  const hand = [
    "---",
    "feature: demo",
    "status: planned",
    "issue: #5",
    "owner: sean",
    "updated: 2026-01-01",
    "---",
    "",
    "## Notes",
    "keep this paragraph",
    "",
    "## Log",
    "- 2026-01-01 — began",
    "",
    "## Context",
    "Written by hand.",
    "",
  ].join("\n");

  it("keeps an extra section, unknown front matter and the section order, and still merges", () => {
    const m = mergeRecord(hand, "demo", { todo: ["x"], log: ["more"], status: ["in-progress"] }, "2026-11-22");
    expect(m.text).toContain("## Notes\nkeep this paragraph");
    expect(m.text).toContain("owner: sean");
    expect(m.text.indexOf("## Notes")).toBeLessThan(m.text.indexOf("## Log"));
    expect(m.text.indexOf("## Log")).toBeLessThan(m.text.indexOf("## Context"));
    expect(m.text).toContain("## Todo\n- [ ] x");
    expect(bullets(m.text, "Log")).toEqual(["- 2026-11-22 — more", "- 2026-01-01 — began"]);
    expect(m.text).toContain("status: in-progress");
  });

  it("updates front matter keys nested under `metadata:` in place instead of adding a second set: the auto-memory format wraps them", () => {
    const nested = "---\nname: \"\"\nmetadata:\n  feature: demo\n  status: planned\n  issue: #5\n  updated: 2026-01-01\n---\n\n## Log\n- 2026-01-01 — began\n";
    const m = mergeRecord(nested, "demo", { status: ["done"], log: ["x"] }, "2026-11-22");
    expect(m.text).toContain("metadata:\n  feature: demo\n  status: done\n  issue: #5\n  updated: 2026-11-22\n---");
    expect(m.text.match(/status:/g)).toHaveLength(1);
    expect(m.issue).toBe("#5");
  });

  it("a second run on the merged text changes nothing but the date: the format round-trips", () => {
    const once = mergeRecord(hand, "demo", { todo: ["x"] }, "2026-11-22").text;
    const twice = mergeRecord(once, "demo", { todo: ["x"] }, "2026-11-22").text;
    expect(twice).toBe(once);
  });
});

describe("INDEX.md and MEMORY.md", () => {
  it("sorts in-progress, blocked, planned, then done and dropped, and keeps a feature's place among equals", () => {
    const s = store();
    s.rec("a-done", "status: done\nlog: shipped");
    s.rec("b-plan", "status: planned\nlog: idea");
    s.rec("c-live", "status: in-progress\nlog: going");
    s.rec("d-stuck", "status: blocked\nlog: waiting");
    s.rec("e-live", "status: in-progress\nlog: also going");
    s.rec("c-live", "log: more");
    const order = (s.fs.get(`${DIR}/INDEX.md`) ?? "").split("\n").filter((l) => l.startsWith("- [")).map((l) => l.slice(3, l.indexOf("]")));
    expect(order).toEqual(["c-live", "e-live", "d-stuck", "b-plan", "a-done"]);
  });

  it("lists the feature once and writes its status, issue and where it stands", () => {
    const s = store();
    s.rec("demo", "issue: 9\nlog: started");
    s.rec("demo", "status: blocked\nlog: stuck on API");
    const lines = (s.fs.get(`${DIR}/INDEX.md`) ?? "").split("\n").filter((l) => l.startsWith("- ["));
    expect(lines).toEqual(["- [demo](demo.md) — blocked — #9 — stuck on API"]);
  });

  it("changes only the Feature memory line in MEMORY.md and leaves every other line byte for byte", () => {
    const before = `${["- [Other note](other.md) — keep", "- [Feature memory](features/INDEX.md) — active: old — next: old thing", "- [Pitch](pitch.md) — keep too"].join("\n")}\n`;
    const s = store({ [MEM]: before });
    s.rec("demo", "status: in-progress\nlog: begun\nnext: write the parser");
    const rows = (s.fs.get(MEM) ?? "").split("\n");
    expect(rows[0]).toBe("- [Other note](other.md) — keep");
    expect(rows[1]).toBe("- [Feature memory](features/INDEX.md) — active: demo — next: write the parser");
    expect(rows[2]).toBe("- [Pitch](pitch.md) — keep too");
    expect(rows).toHaveLength(4);
  });

  it("creates the MEMORY.md line when it is absent and says none when nothing is in progress", () => {
    const s = store({ [MEM]: "- [Pitch](pitch.md) — keep\n" });
    s.rec("demo", "status: done\nlog: shipped");
    expect(s.fs.get(MEM)).toBe("- [Pitch](pitch.md) — keep\n- [Feature memory](features/INDEX.md) — active: none — next: none\n");
  });

  it("updateIndex leaves lines it does not understand where they are", () => {
    const text = "# Features\n\n- [x](x.md) — done — none — old\nNOTE: hand-written\n";
    expect(updateIndex(text, { slug: "y", status: "in-progress", issue: "none" })).toBe(
      "# Features\n\n- [y](y.md) — in-progress — none — none\n- [x](x.md) — done — none — old\nNOTE: hand-written\n",
    );
  });
});

describe("record: size and output", () => {
  it("writes a file over 150 lines and says so, so no record is lost to a size limit", () => {
    const s = store();
    const many = Array.from({ length: 160 }, (_, i) => `link: doc ${i}: https://x/${i}`).join("\n");
    const r = s.rec("demo", many);
    expect(r.code).toBe(0);
    expect(r.out).toContain("over 150 lines: ask context-memory to shorten Context and the earlier log");
    expect(s.file("demo").split("\n").length).toBeGreaterThan(150);
  });

  it("prints the path then three summary lines", () => {
    const s = store();
    const r = s.rec("demo", "log: hi");
    const lines = (r.out ?? "").split("\n");
    expect(lines[0]).toBe(`${DIR}/demo.md`);
    expect(lines).toHaveLength(4);
  });
});

describe("recall", () => {
  it("prints the brief: open todos only, decisions that still bind, newest log entry", () => {
    const s = store();
    s.rec("demo", "status: in-progress\nissue: #3\ncontext: A thing.\ndecision: use D1 — cheap — chat\nlink: PR: #4\ntodo: a\ntodo: b\ndone: a\nlog: first");
    s.rec("demo", "log: second");
    const out = run(["recall", "demo"], "", s.deps).out ?? "";
    expect(out).toContain("Feature: demo — in-progress — #3");
    expect(out).toContain("Context: A thing.");
    expect(out).toContain("- [ ] b");
    expect(out).not.toContain("- [x] a");
    expect(out).toContain("Last log: 2026-11-22 — second");
  });

  it("recall of a missing feature exits 0, says nothing is recorded and offers the closest slugs", () => {
    const s = store();
    s.rec("team-invites", "log: x");
    s.rec("billing", "log: y");
    const r = run(["recall", "team-invite"], "", s.deps);
    expect(r.code).toBe(0);
    expect(r.out).toBe("nothing recorded for team-invite\nclosest slugs: team-invites");
  });

  it("recall by issue number finds the feature", () => {
    const s = store();
    s.rec("demo", "issue: #58\nlog: x");
    expect(run(["recall", "#58"], "", s.deps).out).toContain("Feature: demo");
  });

  it("recall status lists only in-progress and blocked, each with its newest log line", () => {
    const s = store();
    s.rec("live", "status: in-progress\nlog: one");
    s.rec("live", "log: two");
    s.rec("stuck", "status: blocked\nlog: waiting on keys");
    s.rec("old", "status: done\nlog: shipped");
    const out = run(["recall", "status"], "", s.deps).out ?? "";
    expect(out).toContain("newest log: - 2026-11-22 — two");
    expect(out).toContain("[stuck]");
    expect(out).not.toContain("[old]");
  });

  it("recall writes nothing", () => {
    const s = store();
    s.rec("demo", "log: x");
    const n = s.writes.length;
    run(["recall", "demo"], "", s.deps);
    run(["recall", "status"], "", s.deps);
    expect(s.writes).toHaveLength(n);
  });
});

describe("closestSlugs", () => {
  it("prefers a slug sharing a word over a merely short edit distance", () => {
    expect(closestSlugs("team-invites-ui", ["a-b", "team-invites"])).toEqual(["team-invites"]);
  });
});
