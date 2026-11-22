import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  checkBody,
  compare,
  extraMilliseconds,
  firstLoad,
  formatChange,
  loadTimeLine,
  measure,
  pages,
  parseManifest,
  parseReport,
  parseWorkerGzip,
  pathOf,
  chainOf,
  prSection,
  renderComparison,
  renderTable,
  touchesShippedCode,
  type SizeReport,
} from "../size-report";

const manifestObject = {
  entry: { module: "/assets/entry.js", imports: ["/assets/react.js"], css: [] },
  routes: {
    root: { id: "root", path: "", hasDefaultExport: true, module: "/assets/root.js", imports: ["/assets/react.js"], css: ["/assets/root.css"] },
    "routes/api/trpc.$": { id: "routes/api/trpc.$", parentId: "root", path: "/api/trpc/*", hasDefaultExport: false, module: "/assets/trpc.js", imports: [], css: [] },
    "routes/home": { id: "routes/home", parentId: "root", index: true, hasDefaultExport: true, module: "/assets/home.js", imports: ["/assets/ui.js"], css: [] },
    "routes/dashboard/_layout": { id: "routes/dashboard/_layout", parentId: "root", hasDefaultExport: true, module: "/assets/layout.js", imports: ["/assets/ui.js"], css: [] },
    "routes/dashboard/_index": { id: "routes/dashboard/_index", parentId: "routes/dashboard/_layout", path: "dashboard/", hasDefaultExport: true, module: "/assets/dash.js", imports: ["/assets/chart.js"], css: ["/assets/dash.css"] },
  },
};
const manifestText = `window.__reactRouterManifest=${JSON.stringify(manifestObject)};`;
const manifest = Either.getOrThrow(parseManifest(manifestText));

const SIZES: Record<string, number> = {
  "/assets/entry.js": 100,
  "/assets/react.js": 1000,
  "/assets/root.js": 50,
  "/assets/root.css": 300,
  "/assets/home.js": 20,
  "/assets/ui.js": 200,
  "/assets/layout.js": 10,
  "/assets/dash.js": 30,
  "/assets/chart.js": 400,
  "/assets/dash.css": 40,
};

const row = (key: string, label: string, bytes: number) => ({ key, label, bytes });
const report = (...rows: [string, string, number][]): SizeReport => ({ rows: rows.map(([key, label, bytes]) => row(key, label, bytes)) });

describe("reading the build", () => {
  it("reads the manifest out of the window.__reactRouterManifest script React Router writes (the file is JS, not JSON)", () => {
    expect(manifest.entry.module).toBe("/assets/entry.js");
    expect(Object.keys(manifest.routes)).toHaveLength(5);
  });

  it("refuses a manifest with no entry: a renamed build file must fail loudly, not print zeros", () => {
    expect(Either.isLeft(parseManifest("window.__reactRouterManifest={\"routes\":{}};"))).toBe(true);
    expect(Either.isLeft(parseManifest("not a manifest"))).toBe(true);
  });

  it("turns Wrangler's gzip figure into bytes, in KiB or MiB, and fails when the line is missing", () => {
    expect(parseWorkerGzip("Total Upload: 5983.17 KiB / gzip: 1184.06 KiB\n")).toEqual(Either.right(1212477));
    expect(parseWorkerGzip("Total Upload: 12.00 MiB / gzip: 2.50 MiB")).toEqual(Either.right(2621440));
    expect(Either.isLeft(parseWorkerGzip("--dry-run: exiting now."))).toBe(true);
  });

  it("reads a saved report and refuses one with a row that has no byte count", () => {
    expect(parseReport(JSON.stringify(report(["worker", "Worker upload, gzip", 5])))).toEqual(Either.right(report(["worker", "Worker upload, gzip", 5])));
    expect(Either.isLeft(parseReport('{"rows":[{"key":"worker","label":"x"}]}'))).toBe(true);
  });
});

describe("first-load bytes per page", () => {
  it("lists page routes only: no root, no layout, no resource route without a component", () => {
    expect(pages(manifest).map((route) => route.id)).toEqual(["routes/home", "routes/dashboard/_index"]);
  });

  it("names a page by the URL its chain of path segments makes", () => {
    expect(pathOf(chainOf(manifest, "routes/dashboard/_index"))).toBe("/dashboard");
    expect(pathOf(chainOf(manifest, "routes/home"))).toBe("/");
  });

  it("counts the entry, every route from root down and their imports, each file once (react.js is shared by entry and root)", () => {
    const files = firstLoad(manifest, "routes/dashboard/_index");
    expect(files.js).toEqual(["/assets/entry.js", "/assets/react.js", "/assets/root.js", "/assets/layout.js", "/assets/ui.js", "/assets/dash.js", "/assets/chart.js"]);
    expect(files.css).toEqual(["/assets/root.css", "/assets/dash.css"]);
  });

  it("measures the Worker, the entry and root chunks, then each page's first-load JS and CSS, in bytes", () => {
    expect(measure(manifest, SIZES, 1212477).rows).toEqual([
      row("worker", "Worker upload, gzip", 1212477),
      row("entry", "entry.client chunk, gzip", 100),
      row("root", "root chunk, gzip", 50),
      row("route:routes/home:js", "`/` first-load JS, gzip", 1370),
      row("route:routes/home:css", "`/` first-load CSS, gzip", 300),
      row("route:routes/dashboard/_index:js", "`/dashboard` first-load JS, gzip", 1790),
      row("route:routes/dashboard/_index:css", "`/dashboard` first-load CSS, gzip", 340),
    ]);
  });
});

describe("the table", () => {
  const base = report(["worker", "Worker upload, gzip", 1000], ["route:a:js", "`/a` first-load JS, gzip", 500], ["route:gone:js", "`/gone` first-load JS, gzip", 9]);
  const head = report(["worker", "Worker upload, gzip", 1100], ["route:a:js", "`/a` first-load JS, gzip", 500], ["route:new:js", "`/new` first-load JS, gzip", 7]);

  it("prints one column of bytes when there is no base", () => {
    expect(renderTable(head)).toBe(
      ["| | This PR |", "|---|---:|", "| Worker upload, gzip | 1,100 |", "| `/a` first-load JS, gzip | 500 |", "| `/new` first-load JS, gzip | 7 |"].join("\n"),
    );
  });

  it("prints base, this PR and the change, with a row only one side has marked new or removed", () => {
    expect(renderComparison(compare(base, head))).toBe(
      [
        "| | base | This PR | Change |",
        "|---|---:|---:|---:|",
        "| Worker upload, gzip | 1,000 | 1,100 | +100 (+10.0%) |",
        "| `/a` first-load JS, gzip | 500 | 500 | 0 |",
        "| `/new` first-load JS, gzip | — | 7 | new |",
        "| `/gone` first-load JS, gzip | 9 | — | removed |",
      ].join("\n"),
    );
  });

  it("signs a shrink with a minus and leaves the percent out when the base was zero", () => {
    expect(formatChange(2000, 1500)).toBe("-500 (-25.0%)");
    expect(formatChange(0, 10)).toBe("+10");
  });
});

describe("the load-time line", () => {
  it("states the speed and the formula: 1,638.4 bytes cost 8 ms", () => {
    expect(extraMilliseconds(1638.4)).toBeCloseTo(8);
  });

  it("names the page whose first load (JS plus CSS) changed most, with its bytes and milliseconds", () => {
    const base = report(["worker", "Worker upload, gzip", 1], ["route:a:js", "`/a` first-load JS, gzip", 1000], ["route:a:css", "`/a` first-load CSS, gzip", 100], ["route:b:js", "`/b` first-load JS, gzip", 1000]);
    const head = report(["worker", "Worker upload, gzip", 999999], ["route:a:js", "`/a` first-load JS, gzip", 2000], ["route:a:css", "`/a` first-load CSS, gzip", 148.8], ["route:b:js", "`/b` first-load JS, gzip", 0]);
    expect(loadTimeLine(compare(base, head))).toBe(
      "Load time: the largest first-load change is `/a`, +1,048.8 bytes gzip, about +5.1 ms on Lighthouse's slow 4G link (1,638.4 kbit/s); ms = bytes × 8 ÷ 1,638.4.",
    );
  });

  it("reports a saving as a negative time", () => {
    const line = loadTimeLine(compare(report(["route:a:js", "`/a` first-load JS, gzip", 4096]), report(["route:a:js", "`/a` first-load JS, gzip", 0])));
    expect(line).toContain("-4,096 bytes gzip, about -20.0 ms");
  });

  it("says nothing changed when no page's first load moved, even if the Worker did (the Worker is not sent to the browser)", () => {
    const rows = compare(report(["worker", "W", 1], ["route:a:js", "A", 5]), report(["worker", "W", 2], ["route:a:js", "A", 5]));
    expect(loadTimeLine(rows)).toBe("Load time: no page's first-load JS or CSS changed, so no extra transfer time on Lighthouse's slow 4G link (1,638.4 kbit/s).");
  });
});

describe("which PRs need the table", () => {
  it("counts app/, workers/, package.json and bun.lock as shipped code; docs, scripts and workflows are not", () => {
    expect(touchesShippedCode(["app/root.tsx", "workers/app.ts", "package.json", "bun.lock", "docs/x.md", "scripts/size.ts", ".github/workflows/ci.yml", "apps/x"])).toEqual([
      "app/root.tsx",
      "workers/app.ts",
      "package.json",
      "bun.lock",
    ]);
  });

  it("writes the sentence for a PR with no shipped code and the table plus the load line otherwise", () => {
    const rows = compare(report(["worker", "Worker upload, gzip", 1]), report(["worker", "Worker upload, gzip", 1]));
    expect(prSection(["docs/a.md"], rows)).toBe("## Size\n\nNo shipped code changed.");
    const section = prSection(["app/root.tsx"], rows);
    expect(section).toMatch(/^## Size\n\n\| \| base \| This PR \| Change \|/);
    expect(section).toMatch(/\nLoad time: /);
  });
});

describe("checkBody, the CI check on the PR body", () => {
  const table = "## Size\n\n| | base | This PR | Change |\n|---|---:|---:|---:|\n| Worker upload, gzip | 1 | 1 | 0 |";

  it("passes a PR that changes no shipped code, whatever its body says", () => {
    expect(Either.isRight(checkBody("", ["docs/a.md"]))).toBe(true);
  });

  it("passes a PR that changes shipped code and carries the table", () => {
    expect(Either.isRight(checkBody(`Closes #1\n\n${table}`, ["app/root.tsx"]))).toBe(true);
  });

  it("fails a PR that changes shipped code with no table, and says how to make one", () => {
    const result = checkBody("Closes #1", ["app/root.tsx"]);
    expect(Either.isLeft(result) && result.left).toContain("bun run size --base <base branch> --pr-body");
  });

  it("fails a PR that changes shipped code but claims it does not: the sentence is only true of a PR with none", () => {
    const result = checkBody("No shipped code changed.", ["app/a.ts", "app/b.ts", "app/c.ts", "app/d.ts"]);
    expect(Either.isLeft(result) && result.left).toContain('says "No shipped code changed.", but it changes app/a.ts, app/b.ts, app/c.ts.');
  });

  it("does not take the label in running text for the table: only a table row counts", () => {
    expect(Either.isLeft(checkBody("I checked the Worker upload, gzip size by hand.", ["app/a.ts"]))).toBe(true);
  });
});
