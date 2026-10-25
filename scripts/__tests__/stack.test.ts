import { describe, it, expect } from "vitest";
import { run, assignPaths, normalizePath, type Deps, type GitResult, type Plan } from "../stack";

const plan: Plan = {
  base: "main",
  rest: 3,
  prs: [
    { n: 1, branch: "feat/x/1-data", title: "data", fence: ["app/db/schema.ts", "app/repositories/"], message: "feat: data" },
    { n: 2, branch: "feat/x/2-api", title: "api", fence: ["./app/trpc//routes/"], message: "feat: api" },
    { n: 3, branch: "feat/x/3-ui", title: "ui", fence: ["app/routes/"], message: "feat: ui" },
  ],
};
const noRest: Plan = { ...plan, rest: undefined };

/** A git stub: `reply` answers each call by its joined args; every call is recorded. */
function stub(reply: (args: string[]) => Partial<GitResult> = () => ({}), p: Plan = plan) {
  const calls: string[][] = [];
  const deps: Deps = {
    git: (args) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "", ...reply(args) };
    },
    readFile: () => JSON.stringify(p),
  };
  return { deps, calls };
}
const joined = (calls: string[][]) => calls.map((c) => c.join(" "));

describe("assignPaths", () => {
  it("a fence ending in '/' is a prefix and one without is exact: 'app/db/schema.ts' must not claim 'app/db/schema.tsx'", () => {
    const r = assignPaths(noRest, ["app/repositories/user.ts", "app/db/schema.ts", "app/db/schema.tsx", "app/repositoriesX/a.ts"]);
    expect(r.assignments[0].paths).toEqual(["app/repositories/user.ts", "app/db/schema.ts"]);
    expect(r.unassigned).toEqual(["app/db/schema.tsx", "app/repositoriesX/a.ts"]);
  });

  it("normalises './' and doubled slashes on both fences and paths, or a hand-written fence silently matches nothing", () => {
    expect(normalizePath("./app//trpc/")).toBe("app/trpc/");
    const r = assignPaths(noRest, ["./app/trpc/routes/a.ts"]);
    expect(r.assignments[1].paths).toEqual(["app/trpc/routes/a.ts"]);
  });

  it("a path two fences match is reported as an overlap and assigned to neither", () => {
    const p: Plan = { ...noRest, prs: [{ ...plan.prs[0], fence: ["app/"] }, { ...plan.prs[1], fence: ["app/db/schema.ts"] }, plan.prs[2]] };
    const r = assignPaths(p, ["app/db/schema.ts"]);
    expect(r.overlaps).toEqual([{ path: "app/db/schema.ts", prs: [1, 2] }]);
    expect(r.assignments.flatMap((a) => a.paths)).toEqual([]);
  });

  it("two fences of the SAME pr matching one path is not an overlap", () => {
    const p: Plan = { ...noRest, prs: [{ ...plan.prs[0], fence: ["app/", "app/a.ts"] }] };
    const r = assignPaths(p, ["app/a.ts"]);
    expect(r.overlaps).toEqual([]);
    expect(r.assignments[0].paths).toEqual(["app/a.ts"]);
  });

  it("unmatched paths go to plan.rest when set, else to unassigned", () => {
    expect(assignPaths(plan, ["README.md"]).assignments[2].paths).toEqual(["README.md"]);
    expect(assignPaths(noRest, ["README.md"]).unassigned).toEqual(["README.md"]);
  });
});

describe("exclude", () => {
  const ex: Plan = { ...noRest, exclude: ["plans/", "notes.md"] };

  it("an excluded untracked file is neither unassigned nor staged: split must not commit a prototype that predates the run", () => {
    const { deps, calls } = stub(
      (a) =>
        a[0] === "status"
          ? { stdout: "?? plans/proto.html\n?? notes.md\n M app/db/schema.ts\n" }
          : a[0] === "rev-list"
            ? { stdout: "0\n" }
            : {},
      { ...ex, prs: [ex.prs[0]] },
    );
    const o = run(["split", "--plan", "p.json"], deps);
    expect(o.code).toBe(0);
    expect(joined(calls)).toContain("add -A -- app/db/schema.ts");
    expect(joined(calls).join("\n")).not.toMatch(/plans\/|notes\.md/);
  });

  it("assign reports excluded paths, with the same exact/prefix matching as fences", () => {
    const r = assignPaths(ex, ["plans/a.html", "notes.md", "notes.mdx", "app/db/schema.ts"]);
    expect(r.excluded).toEqual(["plans/a.html", "notes.md"]);
    expect(r.unassigned).toEqual(["notes.mdx"]);
  });
});

describe("stack assign", () => {
  it("a rename counts as the new path and carries the old path, so the deletion is staged with it", () => {
    const { deps } = stub((a) => (a[0] === "status" ? { stdout: "R  app/old.ts -> app/repositories/new.ts\n" } : { stdout: "app/old.ts\napp/repositories/new.ts\n" }));
    const o = run(["assign", "--plan", "p.json"], deps);
    expect((o.out as any).assignments[0].paths).toEqual(["app/repositories/new.ts", "app/old.ts"]);
    expect((o.out as any).assignments[2].paths).toEqual([]);
    expect((o.out as any).unassigned).toEqual([]);
  });

  it("deleted files (only in 'git diff --name-only') and untracked files (only in porcelain) are both assigned", () => {
    const { deps, calls } = stub((a) => (a[0] === "status" ? { stdout: "?? app/routes/new.tsx\n" } : { stdout: "app/repositories/gone.ts\n" }));
    const o = run(["assign", "--plan", "p.json"], deps);
    expect((o.out as any).assignments[0].paths).toEqual(["app/repositories/gone.ts"]);
    expect((o.out as any).assignments[2].paths).toEqual(["app/routes/new.tsx"]);
    expect(joined(calls)).toEqual(["status --porcelain=v1 -uall", "diff --name-only main"]);
  });

  it("changes nothing: no git call that writes", () => {
    const { deps, calls } = stub();
    run(["assign", "--plan", "p.json"], deps);
    expect(calls.every((c) => ["status", "diff"].includes(c[0]))).toBe(true);
  });

  it("a missing --plan or unknown verb exits 1 USAGE", () => {
    const { deps } = stub();
    expect(run(["assign"], deps).err?.code).toBe("USAGE");
    expect(run(["bogus", "--plan", "p"], deps).code).toBe(1);
  });
});

describe("stack split", () => {
  const changed = (a: string[]) =>
    a[0] === "status"
      ? { stdout: " M app/db/schema.ts\n?? app/trpc/routes/x.ts\n?? app/routes/x.tsx\n" }
      : a[0] === "rev-list"
        ? { stdout: "0\n" }
        : a[0] === "rev-parse"
          ? { stdout: "abc123\n" }
          : {};

  it("runs switch -c, add -A -- paths, commit -m for each PR in order, and returns the shas", () => {
    const { deps, calls } = stub(changed);
    const o = run(["split", "--plan", "p.json"], deps);
    expect(o.code).toBe(0);
    expect(joined(calls).slice(2)).toEqual([
      "rev-list --count main..HEAD",
      "diff --cached --name-only",
      "switch -c feat/x/1-data",
      "add -A -- app/db/schema.ts",
      "commit -m feat: data",
      "rev-parse HEAD",
      "switch -c feat/x/2-api",
      "add -A -- app/trpc/routes/x.ts",
      "commit -m feat: api",
      "rev-parse HEAD",
      "switch -c feat/x/3-ui",
      "add -A -- app/routes/x.tsx",
      "commit -m feat: ui",
      "rev-parse HEAD",
    ]);
    expect((o.out as any).branches.map((b: any) => [b.n, b.sha])).toEqual([[1, "abc123"], [2, "abc123"], [3, "abc123"]]);
  });

  it("refuses with exit 3 and touches no branch when a path is unassigned", () => {
    const { deps, calls } = stub((a) => (a[0] === "status" ? { stdout: "?? stray.txt\n" } : {}), noRest);
    const o = run(["split", "--plan", "p.json"], deps);
    expect(o.code).toBe(3);
    expect(o.err?.code).toBe("DIRTY_UNASSIGNED");
    expect(o.err?.error).toContain("stray.txt");
    expect(calls.some((c) => ["switch", "add", "commit"].includes(c[0]))).toBe(false);
  });

  it("refuses on overlapping fences before any write", () => {
    const p: Plan = { ...plan, prs: [{ ...plan.prs[0], fence: ["app/"] }, ...plan.prs.slice(1)] };
    const { deps, calls } = stub((a) => (a[0] === "status" ? { stdout: "?? app/routes/x.tsx\n" } : {}), p);
    const o = run(["split", "--plan", "p.json"], deps);
    expect(o.code).toBe(3);
    expect(o.err?.error).toContain("overlap");
    expect(calls.some((c) => c[0] === "switch")).toBe(false);
  });

  it("refuses when HEAD already has commits not on base: split would bury them under the first PR", () => {
    const { deps, calls } = stub((a) => (a[0] === "rev-list" ? { stdout: "2\n" } : changed(a)));
    const o = run(["split", "--plan", "p.json"], deps);
    expect(o.code).toBe(3);
    expect(o.err?.code).toBe("HEAD_AHEAD");
    expect(calls.some((c) => c[0] === "switch")).toBe(false);
  });

  it("refuses staged files: each `git commit` would take all of them into the first PR", () => {
    const { deps, calls } = stub((a) => (a[0] === "diff" && a.includes("--cached") ? { stdout: "app/routes/x.tsx\n" } : changed(a)));
    const o = run(["split", "--plan", "p.json"], deps);
    expect(o.code).toBe(3);
    expect(o.err?.code).toBe("STAGED_FILES");
    expect(calls.some((c) => c[0] === "switch")).toBe(false);
  });

  it("refuses a PR whose fence matched nothing: an empty commit would fail mid-stack", () => {
    const { deps } = stub((a) => (a[0] === "status" ? { stdout: " M app/db/schema.ts\n" } : changed(a)), noRest);
    const o = run(["split", "--plan", "p.json"], deps);
    expect(o.err?.code).toBe("EMPTY_PR");
  });

  it("a git failure mid-stack exits 2 and stops: later branches are not created", () => {
    const { deps, calls } = stub((a) => (a[0] === "commit" ? { code: 1, stderr: "hook failed" } : changed(a)));
    const o = run(["split", "--plan", "p.json"], deps);
    expect(o.code).toBe(2);
    expect(o.err?.error).toContain("hook failed");
    expect(joined(calls)).not.toContain("switch -c feat/x/2-api");
  });
});

describe("stack restack", () => {
  it("switches to the last branch, rebases it with --update-refs onto branch n, and returns the new heads", () => {
    const { deps, calls } = stub((a) => (a[0] === "rev-parse" ? { stdout: `sha-${a[1]}\n` } : {}));
    const o = run(["restack", "--plan", "p.json", "--from", "1"], deps);
    expect(o.code).toBe(0);
    expect(joined(calls).slice(0, 2)).toEqual(["switch feat/x/3-ui", "rebase --update-refs feat/x/1-data"]);
    expect(o.out).toEqual({
      rebased: ["feat/x/2-api", "feat/x/3-ui"],
      heads: [
        { branch: "feat/x/1-data", sha: "sha-feat/x/1-data" },
        { branch: "feat/x/2-api", sha: "sha-feat/x/2-api" },
        { branch: "feat/x/3-ui", sha: "sha-feat/x/3-ui" },
      ],
    });
  });

  it("on conflict lists the conflicting paths, aborts the rebase and exits 4: never leaves the tree mid-rebase", () => {
    const { deps, calls } = stub((a) =>
      a[0] === "rebase" && a[1] === "--update-refs"
        ? { code: 1, stderr: "CONFLICT" }
        : a[0] === "diff"
          ? { stdout: "app/db/schema.ts\napp/a.ts\n" }
          : {},
    );
    const o = run(["restack", "--plan", "p.json", "--from", "1"], deps);
    expect(o.code).toBe(4);
    expect(o.err?.code).toBe("CONFLICT");
    expect(o.err?.error).toContain("app/db/schema.ts, app/a.ts");
    expect(joined(calls).at(-1)).toBe("rebase --abort");
  });

  it("a rebase that fails without conflicts is a git failure (exit 2), not CONFLICT, and is still aborted", () => {
    const { deps, calls } = stub((a) => (a[0] === "rebase" && a[1] === "--update-refs" ? { code: 128, stderr: "dirty tree" } : {}));
    const o = run(["restack", "--plan", "p.json", "--from", "1"], deps);
    expect(o.code).toBe(2);
    expect(joined(calls)).toContain("rebase --abort");
  });

  it("--from is required and must name a PR in the plan", () => {
    const { deps } = stub();
    expect(run(["restack", "--plan", "p.json"], deps).code).toBe(1);
    expect(run(["restack", "--plan", "p.json", "--from", "9"], deps).code).toBe(1);
  });
});
