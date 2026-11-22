import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { pageSlug, parseArgs, run, type Deps } from "../lighthouse";

const CWD = "/repo";
const LIMITS = JSON.stringify({ minScore: 90, maxLcpMs: 2500, maxTbtMs: 200, maxCls: 0.1 });

const report = (score: number): string =>
  JSON.stringify({
    categories: { performance: { score } },
    audits: {
      "largest-contentful-paint": { numericValue: 1000 },
      "total-blocking-time": { numericValue: 0 },
      "cumulative-layout-shift": { numericValue: 0 },
    },
  });

function fake(options: { fail?: RegExp; signIn?: Either.Either<string, string>; ready?: boolean } = {}) {
  const events: string[] = [];
  const files = new Map<string, string>([[`${CWD}/.github/lighthouse-limits.json`, LIMITS]]);
  const err: string[] = [];
  const out: string[] = [];
  let dirs = 0;
  const deps: Deps = {
    cwd: CWD,
    run: (command, args, cwd) => {
      const line = `${cwd}: ${command} ${args.join(" ")}`;
      if (options.fail?.test(line)) {
        events.push(`FAIL ${line}`);
        return { code: 1, stdout: "", stderr: "boom" };
      }
      const output = args.find((arg) => arg.startsWith("--output-path="))?.slice("--output-path=".length);
      if (output) {
        const cookie = args.find((arg) => arg.startsWith("--extra-headers="));
        events.push(`lighthouse ${args[1]}${cookie ? " with cookie" : ""}`);
        files.set(`${output}.report.json`, report(0.95));
      } else events.push(line);
      return { code: 0, stdout: args[0] === "rev-parse" ? "abc\n" : "", stderr: "" };
    },
    start: (command, args, cwd) => {
      events.push(`start ${cwd}: ${command} ${args.join(" ")}`);
      return { stop: async () => void events.push(`stop ${cwd}`) };
    },
    ready: async (url) => {
      events.push(`ready ${url}`);
      return options.ready ?? true;
    },
    signIn: async () => options.signIn ?? Either.right("better-auth.session_token=x"),
    read: (path) => files.get(path),
    write: (path, text) => {
      files.set(path, text);
      events.push(`write ${path}`);
    },
    mkdir: () => {},
    tempDir: () => `/tmp/lh-${++dirs}`,
    remove: (path) => events.push(`remove ${path}`),
    secret: () => "s".repeat(64),
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  return { deps, events, files, err, out };
}

describe("parseArgs", () => {
  it("reads --base, --reports, --json and --markdown", () => {
    expect(parseArgs([])).toEqual(Either.right({ base: undefined, reports: undefined, json: undefined, markdown: undefined }));
    expect(parseArgs(["--base", "origin/staging", "--reports", "r", "--json", "j", "--markdown", "m"])).toEqual(
      Either.right({ base: "origin/staging", reports: "r", json: "j", markdown: "m" }),
    );
  });

  it("refuses an unknown flag and a missing value", () => {
    for (const argv of [["--nope", "1"], ["--base"], ["--runs", "5"], ["--json", "--base"]]) expect(Either.isLeft(parseArgs(argv))).toBe(true);
  });
});

describe("pageSlug", () => {
  it("names report files after the page", () => {
    expect(["/", "/login", "/sign-up", "/dashboard"].map(pageSlug)).toEqual(["home", "login", "sign-up", "dashboard"]);
  });
});

describe("bun run lighthouse", () => {
  it("prepares the worktree with the auth URL the server needs before it builds, serves it, and runs each page three times", async () => {
    const f = fake();
    expect(await run([], f.deps)).toBe(0);
    expect(f.events).toEqual([
      `${CWD}: git rev-parse --verify HEAD^{commit}`,
      `${CWD}: git worktree add --detach /tmp/lh-1 abc`,
      "/tmp/lh-1: bun install --frozen-lockfile --ignore-scripts",
      "write /tmp/lh-1/.dev.vars",
      "/tmp/lh-1: bun run db:migrate:local",
      "/tmp/lh-1: bun run db:seed",
      "/tmp/lh-1: bun run build",
      "start /tmp/lh-1: bun x vite preview --port 4173 --strictPort",
      "ready http://localhost:4173",
      ...["/", "/login", "/sign-up"].flatMap((page) => Array(3).fill(`lighthouse http://localhost:4173${page}`)),
      ...Array(3).fill("lighthouse http://localhost:4173/dashboard with cookie"),
      "stop /tmp/lh-1",
      `${CWD}: git worktree remove --force /tmp/lh-1`,
      "remove /tmp/lh-1",
    ]);
    expect(f.files.get("/tmp/lh-1/.dev.vars")).toBe(`BETTER_AUTH_URL=http://localhost:4173\nBETTER_AUTH_SECRET=${"s".repeat(64)}\n`);
    expect(f.out[0]).toContain("| `/dashboard` | 95 | 1,000 ms | 0 ms | 0.000 |");
  });

  it("stops this PR's server before it serves the base on the same port, so the base numbers come from the base build", async () => {
    const f = fake();
    expect(await run(["--base", "origin/staging", "--json", "/out/lh.json"], f.deps)).toBe(0);
    expect(f.events.indexOf("stop /tmp/lh-1")).toBeLessThan(f.events.indexOf("start /tmp/lh-3: bun x vite preview --port 4173 --strictPort"));
    expect(f.out[0]).toContain("| `/` | 95 → 95 |");
    expect(JSON.parse(f.files.get("/out/lh.json") ?? "{}").base.ref).toBe("origin/staging");
  });

  it("a failed seed stops the run before any server starts, removes the worktree and exits 1", async () => {
    const f = fake({ fail: /db:seed/ });
    expect(await run([], f.deps)).toBe(1);
    expect(f.events.some((event) => event.startsWith("start"))).toBe(false);
    expect(f.events).toContain(`${CWD}: git worktree remove --force /tmp/lh-1`);
    expect(f.err[0]).toContain("`bun run db:seed` failed");
  });

  it("a sign-in that fails stops the server and exits 1: /dashboard measured signed out would be the login redirect", async () => {
    const f = fake({ signIn: Either.left("signing in as the seeded user returned 500") });
    expect(await run([], f.deps)).toBe(1);
    expect(f.events).toContain("stop /tmp/lh-1");
    expect(f.events.some((event) => event.startsWith("lighthouse"))).toBe(false);
    expect(f.err[0]).toBe("signing in as the seeded user returned 500");
  });

  it("a server that never answers fails with the URL it waited on", async () => {
    const f = fake({ ready: false });
    expect(await run([], f.deps)).toBe(1);
    expect(f.err[0]).toBe("the production build of HEAD never answered on http://localhost:4173");
  });

  it("warns, never fails, on a page past a limit", async () => {
    const f = fake();
    f.files.set(`${CWD}/.github/lighthouse-limits.json`, JSON.stringify({ minScore: 99, maxLcpMs: 2500, maxTbtMs: 200, maxCls: 0.1 }));
    expect(await run([], f.deps)).toBe(0);
    expect(f.err).toContain("::warning::Lighthouse: `/` performance score 95 is below 99");
  });

  it("refuses to start without a readable limits file", async () => {
    const f = fake();
    f.files.delete(`${CWD}/.github/lighthouse-limits.json`);
    expect(await run([], f.deps)).toBe(1);
    expect(f.events).toEqual([]);
  });
});
