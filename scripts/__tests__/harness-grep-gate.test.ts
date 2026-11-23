import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HARNESS_ROOT } from "../lib/harness-config";

const checkScript = readFileSync(join(HARNESS_ROOT, "scripts/harness-check.sh"), "utf8");
const start = checkScript.indexOf("# N. The grep gate");
const end = checkScript.indexOf("# end N");
const gate = checkScript.slice(start, end);
const stubs = 'ok() { echo "OK $1"; }\nfail() { echo "FAIL $1"; }\n';
const i2Start = checkScript.indexOf("# I2. brand-init");
const i2End = checkScript.indexOf("# end I2");
const i2Gate = checkScript.slice(i2Start, i2End);
const configStub =
  'bun() { case "$3" in\n' +
  '  brandInit.primitiveLanes) [ "${LANES_RC:-0}" = 0 ] && printf "%s" "$LANES"; return "${LANES_RC:-0}";;\n' +
  '  paths.primitives) [ "${PRIM_RC:-0}" = 0 ] && printf "%s" "$PRIM"; return "${PRIM_RC:-0}";;\n' +
  "esac; }\n";
const APP = ["ap", "p/"].join("");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runBlock(files: Record<string, string>, block: string, prelude = "", env: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "grep-gate-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return execFileSync("bash", ["-c", `${stubs}${prelude}${block}`], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
}

const runGate = (files: Record<string, string>, prelude = "") => runBlock(files, gate, prelude);

describe("harness-check.sh check N, the grep gate", () => {
  it("is found in the script: a renamed marker would make every case below test an empty gate", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("fails and prints file:line for a literal path in a harness script: a project path pasted back in must not pass", () => {
    const out = runGate({ "scripts/tracker.ts": `const a = 1;\nconst root = "${APP}routes";\n` });
    expect(out).toContain("FAIL");
    expect(out).toContain("scripts/tracker.ts:2:");
  });

  it("fails for a literal in a workflow source, at the start of a line, after a space, a backtick and a quote", () => {
    const lines = [`${APP}x`, `see ${APP}x`, `\`${APP}x\``, `'${APP}x'`];
    const out = runGate({ ".claude/workflow-src/ship-feature.js": `${lines.join("\n")}\n` });
    expect(out).toContain("FAIL");
    for (const n of [1, 2, 3, 4]) expect(out).toContain(`ship-feature.js:${n}:`);
  });

  it("names every offending file, not just the first", () => {
    const out = runGate({ "scripts/stack.ts": `x(\`${APP}a\`)\n`, "scripts/lib/audit-login.ts": `x("${APP}b")\n` });
    expect(out).toContain("scripts/stack.ts:1:");
    expect(out).toContain("scripts/lib/audit-login.ts:1:");
  });

  it("passes for a webapp folder, a node_modules path, a dotted or dashed prefix and a clean file: the pattern must not over-match", () => {
    const text = ["webapp/routes", "node_modules/app/index.js", "my-app/x", "my_app/x", ".app/x", "a.app/x", "x/app/y"].join("\n");
    const out = runGate({ "scripts/tracker.ts": `${text}\n`, "scripts/stack.ts": "const x = 1;\n" });
    expect(out).toContain("OK");
    expect(out).not.toContain("FAIL");
  });

  it("does not look at files outside its list: tests, fixtures and the app's own scripts may name the folder", () => {
    const out = runGate({ "scripts/__tests__/x.test.ts": `"${APP}x"\n`, "scripts/seed-preview.ts": `"${APP}x"\n`, "scripts/tracker.ts": "ok\n" });
    expect(out).toContain("OK");
  });

  it("holds the literal nowhere in harness-check.sh itself", () => {
    expect(checkScript).not.toContain(APP);
  });
});

describe("harness-check.sh check N, when grep itself fails", () => {
  it("regression: a grep that cannot read its files is a failure, not a clean pass: a gate that checked nothing must not say ok", () => {
    const out = runGate({ "scripts/tracker.ts": "const a = 1;\n" }, "grep() { return 2; }\n");
    expect(out).toContain("FAIL");
    expect(out).toContain("grep exited 2");
    expect(out).not.toContain("OK");
  });

  it("still passes when grep finds nothing (exit 1): no match is the good case", () => {
    expect(runGate({ "scripts/tracker.ts": "const a = 1;\n" })).toContain("OK");
  });
});

describe("harness-check.sh check I2, the primitive lanes", () => {
  const lanes = '[{"name":"p","motion":true,"files":["button","card"]}]';
  const run = (files: Record<string, string>, env: Record<string, string>) => runBlock(files, i2Gate, configStub, env);

  it("is found in the script: a renamed marker would make every case below test an empty block", () => {
    expect(i2Start).toBeGreaterThan(0);
    expect(i2End).toBeGreaterThan(i2Start);
  });

  it("regression: lanes are configured but paths.primitives names a folder that is not there: a failure with a plain line, not a silent skip", () => {
    const out = run({}, { LANES: lanes, PRIM: "src/ui" });
    expect(out).toContain("FAIL brand-init has primitive lanes, but paths.primitives (src/ui) is not a folder");
  });

  it("regression: lanes are configured and paths.primitives is not set: a failure that says so", () => {
    expect(run({}, { LANES: lanes, PRIM_RC: "1" })).toContain("FAIL brand-init has primitive lanes, but paths.primitives (not set) is not a folder");
  });

  it("skips only when no primitive lane is configured: no key, or an empty list", () => {
    expect(run({}, { LANES_RC: "1", PRIM: "src/ui" })).toBe("");
    expect(run({}, { LANES: "", PRIM: "src/ui" })).toBe("");
  });

  it("passes when every file in the folder is in exactly one lane and every lane file exists", () => {
    const out = run({ "ui/button.tsx": "", "ui/card.tsx": "" }, { LANES: lanes, PRIM: "ui" });
    expect(out).toContain("OK brand-init fences cover every ui primitive exactly once");
  });

  it("fails and names a primitive no lane owns and a lane file that is gone", () => {
    const out = run({ "ui/button.tsx": "", "ui/table.tsx": "" }, { LANES: lanes, PRIM: "ui" });
    expect(out).toContain("FAIL brand-init fence mismatch:");
    expect(out).toContain("table(x0)");
    expect(out).toContain("card(no-file)");
  });
});
