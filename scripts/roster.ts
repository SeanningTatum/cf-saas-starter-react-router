/**
 * Keeps the roster table in .claude/agents/README.md in step with the agents' frontmatter.
 *
 *   bun scripts/roster.ts write   rewrite the table between the roster markers
 *   bun scripts/roster.ts check   exit 1 when a frontmatter field is invalid or the table on disk is stale
 *
 * One row per .claude/agents/<name>.md (README.md excluded), sorted by name. The model and effort
 * columns read the frontmatter, so the table cannot say Sonnet is the default while the files say Opus.
 * "What it does" is the first sentence of `description`. The frontmatter here is flat `key: value`
 * lines, so no YAML library is used.
 *
 * Disk access goes through `Deps`, so the tests never touch the file system.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Deps {
  readFile: (path: string) => string;
  writeFile: (path: string, text: string) => void;
  /** File names (not paths) in a directory; [] when it does not exist. */
  listDir: (path: string) => string[];
}

export interface Outcome {
  code: number;
  stdout: string[];
  stderr: string[];
}

export interface Agent {
  name: string;
  description: string;
  tools: string;
  model: string;
  effort: string;
}

const AGENTS_DIR = ".claude/agents";
const README = `${AGENTS_DIR}/README.md`;
export const START = "<!-- roster:start -->";
export const END = "<!-- roster:end -->";
const WRITE_CMD = "bun scripts/roster.ts write";
const MODELS = ["opus", "sonnet", "haiku"];
const EFFORTS = ["low", "medium", "high"];

/** The flat `key: value` lines between the opening `---` and the next `---`. Null when the file has no frontmatter. */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const out: Record<string, string> = {};
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
    if (m?.[1] !== undefined) out[m[1]] = (m[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** The text up to the first ". " or " Examples - ", whichever comes first. A closing period is dropped. */
export function firstSentence(description: string): string {
  const cuts = [description.indexOf(". "), description.indexOf(" Examples - ")].filter(
    (i) => i >= 0,
  );
  const text = cuts.length ? description.slice(0, Math.min(...cuts)) : description;
  return text.trim().replace(/\.$/, "");
}

/** One line per problem, each starting with the file name. Empty when every agent file is valid. `files` maps a file name without `.md` to its text. */
export function validate(files: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const file of Object.keys(files).sort()) {
    const where = `${file}.md`;
    const fm = parseFrontmatter(files[file] ?? "");
    if (!fm) {
      problems.push(`${where}: no frontmatter (the file must start with a --- block)`);
      continue;
    }
    if (!fm.name) problems.push(`${where}: no \`name\``);
    else if (fm.name !== file)
      problems.push(`${where}: \`name\` is "${fm.name}" but the file is ${where}; they must match`);
    if (!fm.description) problems.push(`${where}: no \`description\``);
    if (!fm.tools) problems.push(`${where}: no \`tools\``);
    if (!MODELS.includes(fm.model ?? ""))
      problems.push(
        `${where}: \`model\` is ${fm.model ? `"${fm.model}"` : "missing"}; use one of ${MODELS.join(", ")}`,
      );
    if (!EFFORTS.includes(fm.effort ?? ""))
      problems.push(
        `${where}: \`effort\` is ${fm.effort ? `"${fm.effort}"` : "missing"}; use one of ${EFFORTS.join(", ")}`,
      );
  }
  return problems;
}

/** Agents from valid files, sorted by name. Call `validate` first. */
export function toAgents(files: Record<string, string>): Agent[] {
  return Object.keys(files)
    .sort()
    .map((file) => {
      const fm = parseFrontmatter(files[file] ?? "") ?? {};
      return {
        name: fm.name ?? "",
        description: fm.description ?? "",
        tools: fm.tools ?? "",
        model: fm.model ?? "",
        effort: fm.effort ?? "",
      };
    });
}

const cell = (s: string): string => s.replace(/\|/g, "\\|");

/** The text between the markers, markers included. */
export function renderBlock(agents: Agent[]): string {
  const rows = agents.map(
    (a) =>
      `| [\`${a.name}\`](${a.name}.md) | ${a.model} | ${a.effort} | ${cell(firstSentence(a.description))} |`,
  );
  const counts = MODELS.map((m) => ({ m, n: agents.filter((a) => a.model === m).length }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${c.m}`)
    .join(", ");
  return [
    START,
    `_Generated from each agent's frontmatter by \`${WRITE_CMD}\`. Do not edit between the markers._`,
    "",
    "| Agent | Model | Effort | What it does |",
    "|-------|-------|--------|--------------|",
    ...rows,
    "",
    `${agents.length} agents: ${counts}`,
    END,
  ].join("\n");
}

/** Where the marked block sits in the README: [start of START, end of END). Throws when the markers are missing, repeated or out of order. */
function blockSpan(readme: string): [number, number] {
  const s = readme.indexOf(START);
  const e = readme.indexOf(END);
  if (s < 0 || e < 0)
    throw new Error(
      `${README}: needs one ${START} line and one ${END} line around the roster table`,
    );
  if (readme.indexOf(START, s + 1) >= 0 || readme.indexOf(END, e + 1) >= 0)
    throw new Error(`${README}: ${START} and ${END} must each appear once`);
  if (e < s) throw new Error(`${README}: ${END} comes before ${START}`);
  return [s, e + END.length];
}

/** The README with the block replaced and everything outside the markers untouched. */
export function applyBlock(readme: string, block: string): string {
  const [s, e] = blockSpan(readme);
  return readme.slice(0, s) + block + readme.slice(e);
}

const fail = (...stderr: string[]): Outcome => ({ code: 1, stdout: [], stderr });

/** Runs one verb. `root` is the repo root. */
export function run(argv: string[], root: string, deps: Deps): Outcome {
  const verb = argv[0];
  if (argv.length !== 1 || (verb !== "write" && verb !== "check")) {
    return fail(
      `roster: ${verb ? `unknown arguments "${argv.join(" ")}"` : "a verb is required"}`,
      "usage: bun scripts/roster.ts write|check",
    );
  }
  const dir = join(root, AGENTS_DIR);
  const files: Record<string, string> = {};
  try {
    for (const f of deps.listDir(dir).filter((f) => f.endsWith(".md") && f !== "README.md")) {
      files[f.slice(0, -3)] = deps.readFile(join(dir, f));
    }
  } catch (e) {
    return fail(`roster: ${(e as Error).message}`);
  }
  if (!Object.keys(files).length) return fail(`roster: no agent files in ${AGENTS_DIR}`);
  const problems = validate(files);
  if (problems.length) return fail(...problems.map((p) => `roster: ${AGENTS_DIR}/${p}`));

  const block = renderBlock(toAgents(files));
  const path = join(root, README);
  let readme: string;
  let want: string;
  try {
    readme = deps.readFile(path);
    want = applyBlock(readme, block);
  } catch (e) {
    return fail(`roster: ${(e as Error).message}`);
  }
  const n = Object.keys(files).length;
  if (verb === "write") {
    if (want !== readme) deps.writeFile(path, want);
    return {
      code: 0,
      stdout: [`roster: wrote ${n} agents to ${README}${want === readme ? " (no change)" : ""}`],
      stderr: [],
    };
  }
  if (want !== readme)
    return fail(
      `roster: the table in ${README} is stale (it must match the agents' frontmatter)`,
      `fix: run \`${WRITE_CMD}\` and commit the result`,
    );
  return {
    code: 0,
    stdout: [`roster: ${n} agents valid, table in ${README} is current`],
    stderr: [],
  };
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
};

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const o = run(process.argv.slice(2), root, defaultDeps);
  for (const l of o.stdout) console.log(l);
  for (const l of o.stderr) console.error(l);
  process.exit(o.code);
}
