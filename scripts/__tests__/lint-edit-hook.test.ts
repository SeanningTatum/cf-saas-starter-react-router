import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.claude/hooks/lint-edit.sh");
const BLOCKING = 2;
const made: string[] = [];

interface Checkout {
  root: string;
  argsFile: string;
}

function checkout(lintExit: number, lintOutput: string): Checkout {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lint-edit-hook-")));
  made.push(root);
  const argsFile = path.join(root, "lint-args.txt");
  fs.mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "app/lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "biome.jsonc"), "{}");
  fs.writeFileSync(path.join(root, "node_modules/.bin/biome"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(
    path.join(root, "scripts/lint-all.ts"),
    [
      'import fs from "node:fs";',
      `fs.writeFileSync(${JSON.stringify(argsFile)}, process.argv.slice(2).join(" "));`,
      `console.log(${JSON.stringify(lintOutput)});`,
      `process.exit(${lintExit});`,
    ].join("\n"),
  );
  return { root, argsFile };
}

function runHook(stdin: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  return spawnSync("bash", [HOOK], { input: stdin, encoding: "utf8", env, cwd: os.tmpdir() });
}

const edited = (file: string) => JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } });

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe(".claude/hooks/lint-edit.sh", () => {
  it("exits 2 with the findings on stderr, so the agent is shown what its edit broke", () => {
    const { root, argsFile } = checkout(1, "app/lib/a.ts:3:7 lint/suspicious/noExplicitAny: Unexpected any.");
    const file = path.join(root, "app/lib/a.ts");
    fs.writeFileSync(file, "export const a = 1;\n");

    const result = runHook(edited(file));

    expect(result.status).toBe(BLOCKING);
    expect(result.stderr).toContain("app/lib/a.ts:3:7 lint/suspicious/noExplicitAny: Unexpected any.");
    expect(result.stdout).toBe("");
    expect(fs.readFileSync(argsFile, "utf8")).toBe("--fix app/lib/a.ts");
  });

  it("stays silent and exits 0 on a clean file, so a good edit costs the agent nothing", () => {
    const { root } = checkout(0, "lint: clean (biome 0, house 0)");
    const file = path.join(root, "app/lib/a.ts");
    fs.writeFileSync(file, "export const a = 1;\n");

    const result = runHook(edited(file));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  it("finds the checkout from the edited file, so a git worktree is linted with its own config", () => {
    const { root, argsFile } = checkout(0, "");
    const file = path.join(root, "app/lib/deep.ts");
    fs.writeFileSync(file, "export const deep = 1;\n");

    runHook(edited(file));

    expect(fs.readFileSync(argsFile, "utf8")).toBe("--fix app/lib/deep.ts");
  });

  it.each([
    ["a Markdown file", "README.md"],
    ["a shell script", "scripts/run.sh"],
  ])("does nothing for %s, so prose and shell edits are never sent to the linter", (_kind, name) => {
    const { root, argsFile } = checkout(1, "should not run");
    const file = path.join(root, name);
    fs.writeFileSync(file, "x\n");

    const result = runHook(edited(file));

    expect(result.status).toBe(0);
    expect(fs.existsSync(argsFile)).toBe(false);
  });

  it("does nothing when the tools are not installed, so a fresh clone can still be edited", () => {
    const { root, argsFile } = checkout(1, "should not run");
    fs.rmSync(path.join(root, "node_modules"), { recursive: true });
    const file = path.join(root, "app/lib/a.ts");
    fs.writeFileSync(file, "export const a = 1;\n");

    const result = runHook(edited(file));

    expect(result.status).toBe(0);
    expect(fs.existsSync(argsFile)).toBe(false);
  });

  it.each([
    ["input that is not JSON", "not json"],
    ["an edit with no file path", JSON.stringify({ tool_name: "Edit", tool_input: {} })],
    ["a file that does not exist", edited(path.join(os.tmpdir(), "lint-edit-hook-missing.ts"))],
  ])("exits 0 on %s, so the hook never fails an edit for its own reasons", (_kind, stdin) => {
    const result = runHook(stdin);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("exits 0 on a file outside any checkout, so an edit to a scratch file is left alone", () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lint-edit-hook-outside-")));
    made.push(outside);
    const file = path.join(outside, "scratch.ts");
    fs.writeFileSync(file, "export const scratch = 1;\n");

    const result = runHook(edited(file));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
