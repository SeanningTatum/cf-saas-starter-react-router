import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { parseArgs, run, type Deps, type RunResult } from "../size";

const CWD = "/repo";
const BASE_DIR = "/tmp/size-base-1";
const SHA = "a".repeat(40);
const MANIFEST = `window.__reactRouterManifest=${JSON.stringify({
  entry: { module: "/assets/entry.js", imports: [], css: [] },
  routes: {
    root: { id: "root", path: "", hasDefaultExport: true, module: "/assets/root.js", imports: [], css: ["/assets/root.css"] },
    "routes/home": { id: "routes/home", parentId: "root", hasDefaultExport: true, module: "/assets/home.js", imports: [], css: [] },
  },
})};`;

interface Fake {
  deps: Deps;
  calls: string[];
  files: Map<string, string>;
  out: string[];
  err: string[];
}

function fake(options: { gzip?: Record<string, number>; fail?: RegExp; diff?: string; files?: Record<string, string> } = {}): Fake {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map(Object.entries(options.files ?? {}));
  const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
  const deps: Deps = {
    cwd: CWD,
    run: (command, args, cwd) => {
      const line = `${cwd}: ${command} ${args.join(" ")}`;
      calls.push(line);
      if (options.fail?.test(line)) return { code: 1, stdout: "", stderr: "boom" };
      if (args.includes("--dry-run")) return ok(`Total Upload: 10.00 KiB / gzip: ${cwd === CWD ? "2.00" : "1.00"} KiB`);
      if (args[0] === "rev-parse") return ok(`${SHA}\n`);
      if (args[0] === "diff") return ok(options.diff ?? "");
      return ok();
    },
    read: (path) => files.get(path) ?? (path.endsWith("manifest-1.js") ? MANIFEST : undefined),
    write: (path, text) => {
      files.set(path, text);
    },
    list: () => ["manifest-1.js", "entry.js", "root.js", "root.css", "home.js"],
    gzipSize: (path) => (options.gzip ?? {})[path.split("/").pop() ?? ""] ?? (path.startsWith(CWD) ? 20 : 10),
    tempDir: () => BASE_DIR,
    remove: (path) => calls.push(`remove ${path}`),
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  return { deps, calls, files, out, err };
}

describe("parseArgs", () => {
  it("reads --base, --json, --markdown and --pr-body", () => {
    expect(parseArgs(["--base", "origin/staging", "--json", "a.json", "--markdown", "a.md", "--pr-body"])).toEqual(
      Either.right({ base: "origin/staging", json: "a.json", markdown: "a.md", prBody: true }),
    );
  });

  it("refuses an unknown flag, a flag with no value, and --pr-body without a git base (it needs the diff)", () => {
    expect(Either.isLeft(parseArgs(["--bse", "x"]))).toBe(true);
    expect(Either.isLeft(parseArgs(["--base"]))).toBe(true);
    expect(Either.isLeft(parseArgs(["--pr-body"]))).toBe(true);
    expect(Either.isLeft(parseArgs(["--pr-body", "--base", "saved.json"]))).toBe(true);
  });
});

describe("bun run size", () => {
  it("builds once in place, reads Wrangler's dry run, and prints one column", () => {
    const f = fake();
    expect(run([], f.deps)).toBe(0);
    expect(f.calls).toEqual([`${CWD}: bun run build`, `${CWD}: bun x wrangler deploy --dry-run`]);
    expect(f.out[0]).toContain("| Worker upload, gzip | 2,048 |");
    expect(f.out[0]).toContain("| `/` first-load JS, gzip | 60 |");
  });

  it("builds the base in a temporary worktree with no install scripts, removes it, and caches the result by commit", () => {
    const f = fake();
    expect(run(["--base", "origin/staging", "--json", "/out/size.json"], f.deps)).toBe(0);
    expect(f.calls.slice(2)).toEqual([
      `${CWD}: git rev-parse --verify origin/staging^{commit}`,
      `${CWD}: git worktree add --detach ${BASE_DIR} ${SHA}`,
      `${BASE_DIR}: bun install --frozen-lockfile --ignore-scripts`,
      `${BASE_DIR}: bun run build`,
      `${BASE_DIR}: bun x wrangler deploy --dry-run`,
      `${CWD}: git worktree remove --force ${BASE_DIR}`,
      `remove ${BASE_DIR}`,
    ]);
    expect(f.out[0]).toContain("| Worker upload, gzip | 1,024 | 2,048 | +1,024 (+100.0%) |");
    expect(f.out[0]).toContain("Load time: the largest first-load change is `/`, +40 bytes gzip");
    expect(f.files.has(`${CWD}/node_modules/.cache/size/${SHA}.json`)).toBe(true);
    expect(JSON.parse(f.files.get("/out/size.json") ?? "{}").rows[0]).toEqual({ key: "worker", label: "Worker upload, gzip", bytes: 2048 });
  });

  it("a second run on the same base commit reads the cache and builds no worktree", () => {
    const first = fake();
    run(["--base", "origin/staging"], first.deps);
    const second = fake({ files: Object.fromEntries(first.files) });
    expect(run(["--base", "origin/staging"], second.deps)).toBe(0);
    expect(second.calls.some((call) => call.includes("worktree"))).toBe(false);
    expect(second.out[0]).toBe(first.out[0]);
  });

  it("reads a saved JSON report as the base, so CI can measure the base once and reuse it", () => {
    const saved = JSON.stringify({ rows: [{ key: "worker", label: "Worker upload, gzip", bytes: 2048 }] });
    const f = fake({ files: { "base.json": saved } });
    expect(run(["--base", "base.json"], f.deps)).toBe(0);
    expect(f.calls.some((call) => call.includes("git"))).toBe(false);
    expect(f.out[0]).toContain("| Worker upload, gzip | 2,048 | 2,048 | 0 |");
  });

  it("--pr-body writes the sentence when the diff from the base touches no shipped code", () => {
    const f = fake({ diff: "docs/a.md\nscripts/size.ts\n" });
    expect(run(["--base", "origin/staging", "--pr-body", "--markdown", "/out/size.md"], f.deps)).toBe(0);
    expect(f.calls).toContain(`${CWD}: git diff --name-only origin/staging...HEAD`);
    expect(f.out[0]).toBe("## Size\n\nNo shipped code changed.");
    expect(f.files.get("/out/size.md")).toBe("## Size\n\nNo shipped code changed.\n");
  });

  it("--pr-body writes the table when the diff touches app/", () => {
    const f = fake({ diff: "app/root.tsx\n" });
    run(["--base", "origin/staging", "--pr-body"], f.deps);
    expect(f.out[0]).toMatch(/^## Size\n\n\| \| base \| This PR \| Change \|/);
  });

  it("a failed base build still removes the worktree and exits 1 with the command that failed", () => {
    const f = fake({ fail: new RegExp(`^${BASE_DIR}: bun run build`) });
    expect(run(["--base", "origin/staging"], f.deps)).toBe(1);
    expect(f.calls).toContain(`${CWD}: git worktree remove --force ${BASE_DIR}`);
    expect(f.err[0]).toContain("`bun run build` failed in /tmp/size-base-1");
    expect([...f.files.keys()].some((path) => path.includes(".cache"))).toBe(false);
  });

  it("a usage error exits 2 before any build", () => {
    const f = fake();
    expect(run(["--nope"], f.deps)).toBe(2);
    expect(f.calls).toEqual([]);
  });
});
