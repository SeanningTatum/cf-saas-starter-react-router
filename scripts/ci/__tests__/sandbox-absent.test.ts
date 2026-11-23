import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SANDBOX_MARKERS } from "../../lib/sandbox-absent-constants";
import { hitsIn, run, scanBuild } from "../sandbox-absent";

const dirs: string[] = [];

const fakeBuild = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-absent-"));
  dirs.push(root);
  for (const part of ["server", "client"]) fs.mkdirSync(path.join(root, part), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("hitsIn", () => {
  it("finds each marker a file holds and nothing else", () => {
    expect(hitsIn("a.js", 'fetch("/sandbox.json");withSpan("sandbox.load_manifest")')).toEqual([
      { file: "a.js", marker: "/sandbox.json" },
      { file: "a.js", marker: "sandbox.load_manifest" },
    ]);
    expect(hitsIn("b.js", 'const paypal = "https://api-m.sandbox.paypal.com"')).toEqual([]);
  });
});

describe("scanBuild", () => {
  it("is clean for a production build that holds no marker, counting every file it read", () => {
    const root = fakeBuild({ "server/index.js": "export default {}", "client/assets/home.js": "x", "server/wrangler.json": '{"vars":{}}' });
    expect(scanBuild(root)).toEqual({ files: 3, hits: [] });
  });

  it.each(SANDBOX_MARKERS)("reports %j when it reaches the server or the client bundle", (marker) => {
    const root = fakeBuild({ "server/assets/chunk.js": `x(${JSON.stringify(marker)})`, "client/assets/manifest.js": marker });
    expect(scanBuild(root)?.hits).toEqual([
      { file: path.join("server", "assets", "chunk.js"), marker },
      { file: path.join("client", "assets", "manifest.js"), marker },
    ]);
  });

  it("reports the SANDBOX_ENABLED var when it reaches the Worker's built wrangler.json", () => {
    const root = fakeBuild({ "server/wrangler.json": '{"vars":{"SANDBOX_ENABLED":"1"}}' });
    expect(scanBuild(root)?.hits).toEqual([{ file: path.join("server", "wrangler.json"), marker: "SANDBOX_ENABLED" }]);
  });

  it("skips files that are not code or config, such as images", () => {
    const root = fakeBuild({ "client/logo.png": "/sandbox.json" });
    expect(scanBuild(root)).toEqual({ files: 0, hits: [] });
  });

  it("gives null when the build is missing, so the gate cannot pass on nothing", () => {
    expect(scanBuild(path.join(os.tmpdir(), "no-such-build-47"))).toBeNull();
  });
});

describe("run", () => {
  it("exits 0 and says how many files it read for a clean build", () => {
    const lines: string[] = [];
    expect(run([fakeBuild({ "server/index.js": "ok" })], (line) => lines.push(line))).toBe(0);
    expect(lines.join("\n")).toMatch(/1 files .* hold no sandbox code/);
  });

  it("exits 1 and prints one line per hit, naming the file, the marker and the fix", () => {
    const root = fakeBuild({ "server/index.js": "routes/sandbox/manifest.ts" });
    const lines: string[] = [];
    expect(run([root], (line) => lines.push(line))).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(path.join(root, "server", "index.js"));
    expect(lines[0]).toContain('holds "routes/sandbox/"');
    expect(lines[0]).toContain("VITE_SANDBOX=1");
  });

  it("exits 2 with no build, telling the reader to build first", () => {
    const lines: string[] = [];
    expect(run([path.join(os.tmpdir(), "no-such-build-47")], (line) => lines.push(line))).toBe(2);
    expect(lines[0]).toContain("bun run build");
  });
});
