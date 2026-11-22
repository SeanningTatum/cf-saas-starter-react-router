/**
 * Builds the runnable workflow scripts from their sources.
 *
 *   bun scripts/workflows.ts build [--out <dir>]   write <out>/<name>.js for each source (default out: .claude/workflows)
 *   bun scripts/workflows.ts check [--out <dir>]   exit 1 when a built file differs from what the sources produce
 *
 * A workflow script is a body, not a module: the Workflow runtime gives it globals, it has no
 * `import`, and it must begin with `export const meta = `. So shared code lives in
 * .claude/workflow-src/lib.js and each source (.claude/workflow-src/<name>.js) marks where it goes
 * with one `// @lib` line after the meta literal. The build replaces that line with the library
 * (its `export ` keywords stripped) and writes the result to .claude/workflows/<name>.js, which stays
 * committed because Claude Code loads workflows from there.
 *
 * Disk access goes through `Deps`, so the tests never touch the file system.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Deps {
  readFile: (path: string) => string;
  writeFile: (path: string, text: string) => void;
  /** File names (not paths) in a directory; [] when it does not exist. */
  listDir: (path: string) => string[];
  mkdirp: (path: string) => void;
}

export interface Outcome {
  code: number;
  stdout: string[];
  stderr: string[];
}

const SRC_DIR = ".claude/workflow-src";
const OUT_DIR = ".claude/workflows";
const LIB_FILE = "lib.js";
const BUILD_CMD = "bun scripts/workflows.ts build";
const META_START = "export const meta = ";
const LIB_MARK = "// @lib";

/** The lib as it is pasted into a workflow: `export ` keywords gone. Refuses an import or an export form it cannot strip. */
export function stripLib(lib: string): string {
  if (/^\s*import\b/m.test(lib) || /\bimport\s*\(/.test(lib)) {
    throw new Error("lib.js must not import anything: a workflow script has no import, so the pasted text would not run");
  }
  const bad = lib.split("\n").find((l) => /^export\s+(default|\{|\*)/.test(l));
  if (bad) throw new Error(`lib.js: only "export const|function|let|class" can be stripped, got: ${bad}`);
  return lib.replace(/^export\s+(?=const\b|let\b|function\b|async\b|class\b)/gm, "").trimEnd();
}

/** Index of the line that closes the meta literal: the first line that is exactly `}` or `};` in column 0. */
function metaEndLine(lines: string[]): number {
  return lines.findIndex((l) => /^\}\s*;?\s*$/.test(l));
}

/** One workflow source plus the library, as the script Claude Code loads. Throws on a source that cannot be built. */
export function buildWorkflow(name: string, source: string, lib: string): string {
  if (!source.startsWith(META_START)) throw new Error(`${name}: a workflow source must begin with "${META_START}"`);
  const lines = source.split("\n");
  const marks = lines.flatMap((l, i) => (l.trim() === LIB_MARK ? [i] : []));
  const mark = marks[0];
  if (mark === undefined || marks.length !== 1) throw new Error(`${name}: expected exactly one "${LIB_MARK}" line, found ${marks.length}`);
  const metaEnd = metaEndLine(lines);
  if (metaEnd < 0) throw new Error(`${name}: could not find the end of the meta literal (a line that is just "}" or "};")`);
  if (mark < metaEnd) throw new Error(`${name}: the "${LIB_MARK}" line must come after the meta literal`);

  const text = stripLib(lib);
  const banner = `// ---- generated from ${SRC_DIR}/${LIB_FILE} by scripts/workflows.ts; edit the source, then run \`${BUILD_CMD}\` ----`;
  const out = [
    ...lines.slice(0, metaEnd + 1),
    `// GENERATED, edit ${SRC_DIR}/${name}.js`,
    ...lines.slice(metaEnd + 1, mark),
    banner,
    text,
    `// ---- end of ${SRC_DIR}/${LIB_FILE} ----`,
    ...lines.slice(mark + 1),
  ];
  return out.join("\n");
}

/** The workflow names a source directory holds: every .js file but lib.js, without the extension. */
export function sourceNames(files: string[]): string[] {
  return files.filter((f) => f.endsWith(".js") && f !== LIB_FILE).map((f) => f.slice(0, -3)).sort();
}

/**
 * What is wrong with the built directory: one line per file. `built` maps name to text and holds
 * every .js file found there.
 */
export function drift(sources: Record<string, string>, built: Record<string, string>, lib: string): string[] {
  const problems: string[] = [];
  for (const name of Object.keys(sources).sort()) {
    if (!(name in built)) {
      problems.push(`${name}.js: no built file for ${SRC_DIR}/${name}.js`);
      continue;
    }
    const want = buildWorkflow(name, sources[name] ?? "", lib);
    if (built[name] !== want) problems.push(`${name}.js: differs from what ${SRC_DIR}/${name}.js and ${SRC_DIR}/${LIB_FILE} produce`);
  }
  for (const name of Object.keys(built).sort()) {
    if (!(name in sources)) problems.push(`${name}.js: no source ${SRC_DIR}/${name}.js (a built file with no source: add the source or delete the file)`);
  }
  return problems;
}

const done = (stdout: string[]): Outcome => ({ code: 0, stdout, stderr: [] });
const fail = (code: number, ...stderr: string[]): Outcome => ({ code, stdout: [], stderr });
const usage = (why: string): Outcome => fail(1, `workflows: ${why}`, "usage: bun scripts/workflows.ts build|check [--out <dir>]");

/** Runs one verb. `root` is the repo root; paths in the messages are relative to it. */
export function run(argv: string[], root: string, deps: Deps): Outcome {
  const verb = argv[0];
  if (verb !== "build" && verb !== "check") return usage(verb ? `unknown verb "${verb}"` : "a verb is required");
  let out = OUT_DIR;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] !== "--out") return usage(`unknown argument ${argv[i]}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) return usage("--out needs a directory");
    out = v;
    i++;
  }
  const srcDir = join(root, SRC_DIR);
  const outDir = out.startsWith("/") ? out : join(root, out);
  const names = sourceNames(deps.listDir(srcDir));
  if (!names.length) return fail(1, `workflows: no workflow sources in ${SRC_DIR}`);
  let lib: string;
  const sources: Record<string, string> = {};
  try {
    lib = deps.readFile(join(srcDir, LIB_FILE));
    for (const n of names) sources[n] = deps.readFile(join(srcDir, `${n}.js`));
  } catch (e) {
    return fail(1, `workflows: ${(e as Error).message}`);
  }

  if (verb === "build") {
    try {
      const lines = names.map((n) => ({ n, text: buildWorkflow(n, sources[n] ?? "", lib) }));
      deps.mkdirp(outDir);
      return done(lines.map(({ n, text }) => {
        deps.writeFile(join(outDir, `${n}.js`), text);
        return `built ${out}/${n}.js (${text.split("\n").length} lines)`;
      }));
    } catch (e) {
      return fail(1, (e as Error).message);
    }
  }

  const built: Record<string, string> = {};
  for (const f of deps.listDir(outDir).filter((f) => f.endsWith(".js"))) built[f.slice(0, -3)] = deps.readFile(join(outDir, f));
  let problems: string[];
  try {
    problems = drift(sources, built, lib);
  } catch (e) {
    return fail(1, (e as Error).message);
  }
  if (problems.length) return fail(1, ...problems.map((p) => `workflows: ${out}/${p}`), `fix: run \`${BUILD_CMD}\` and commit the result (edit ${SRC_DIR}/, never ${out}/)`);
  return done([`workflows: ${names.length} built scripts match their sources`]);
}

export const defaultDeps: Deps = {
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, t) => writeFileSync(p, t),
  listDir: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
  mkdirp: (p) => void mkdirSync(p, { recursive: true }),
};

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const o = run(process.argv.slice(2), root, defaultDeps);
  for (const l of o.stdout) console.log(l);
  for (const l of o.stderr) console.error(l);
  process.exit(o.code);
}
