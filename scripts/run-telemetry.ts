import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT_BAD_INPUT,
  EXIT_OK,
  EXIT_USAGE,
  FLAG_DIR,
  FLAG_MARKDOWN,
  FLAG_PREFIX,
  JOURNAL_FILE_NAME,
  JSON_INDENT,
  MESSAGE_PREFIX,
  MISSING_FILE_CODES,
  RUN_FILE_NAME,
  USAGE_TEXT,
  VERB_INGEST,
  VERB_RECORD,
  VERB_STATS,
  VERB_SUMMARY,
  VERIFY_DIR,
} from "./lib/run-telemetry-constants";
import { emptyRunFile, isValidSlug, mergeLedger, parseLedger, parseRunFile, type RunFile } from "./lib/run-telemetry";
import { ingestJournals, type Journal } from "./lib/run-telemetry-ingest";
import { statsLines, summaryLines } from "./lib/run-telemetry-report";

export interface Deps {
  root: string;
  readStdin: () => string;
  readFile: (path: string) => string | null;
  writeFile: (path: string, text: string) => void;
  mkdirp: (path: string) => void;
  listDir: (path: string) => string[];
}

export interface Outcome {
  code: number;
  stdout: string[];
  stderr: string[];
}

const done = (stdout: string[]): Outcome => ({ code: EXIT_OK, stdout, stderr: [] });
const fail = (why: string): Outcome => ({ code: EXIT_BAD_INPUT, stdout: [], stderr: [`${MESSAGE_PREFIX} ${why}`] });
const usage = (why: string): Outcome => ({
  code: EXIT_USAGE,
  stdout: [],
  stderr: [`${MESSAGE_PREFIX} ${why}`, USAGE_TEXT],
});

interface Parsed {
  positional: string[];
  markdown: boolean;
  dir: string | null;
}

function parseArgs(args: string[], allowed: string[]): Parsed | string {
  const parsed: Parsed = { positional: [], markdown: false, dir: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith(FLAG_PREFIX)) {
      parsed.positional.push(arg);
      continue;
    }
    if (!allowed.includes(arg)) return `unknown option ${arg}`;
    if (arg === FLAG_MARKDOWN) {
      parsed.markdown = true;
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith(FLAG_PREFIX)) return `${arg} needs a value`;
    parsed.dir = value;
    i++;
  }
  return parsed;
}

const runFilePath = (deps: Deps, slug: string) => join(deps.root, VERIFY_DIR, slug, RUN_FILE_NAME);
const runFileLabel = (slug: string) => `${VERIFY_DIR}/${slug}/${RUN_FILE_NAME}`;

function loadRunFile(deps: Deps, slug: string): RunFile | null | string {
  const text = deps.readFile(runFilePath(deps, slug));
  if (text === null) return null;
  const parsed = parseRunFile(text);
  if (typeof parsed === "string") return `${runFileLabel(slug)} is unreadable (${parsed}); fix or delete it`;
  if (parsed.slug !== slug) return `${runFileLabel(slug)} belongs to ${parsed.slug}; fix or delete it`;
  return parsed;
}

function saveRunFile(deps: Deps, file: RunFile): void {
  const path = runFilePath(deps, file.slug);
  deps.mkdirp(dirname(path));
  deps.writeFile(path, `${JSON.stringify(file, null, JSON_INDENT)}\n`);
}

function checkNames(slug: string, workflow: string): string | null {
  if (!isValidSlug(slug)) return `slug "${slug}" must be lower-case words joined by dashes`;
  if (!isValidSlug(workflow)) return `workflow "${workflow}" must be lower-case words joined by dashes`;
  return null;
}

function record(positional: string[], deps: Deps): Outcome {
  const [slug = "", workflow = ""] = positional;
  if (positional.length !== 2) return usage("record needs <slug> <workflow>");
  const badName = checkNames(slug, workflow);
  if (badName !== null) return fail(badName);
  const ledger = parseLedger(deps.readStdin());
  if ("error" in ledger) return fail(ledger.error);
  const existing = loadRunFile(deps, slug);
  if (typeof existing === "string") return fail(existing);
  saveRunFile(deps, mergeLedger(existing ?? emptyRunFile(slug), workflow, ledger.calls));
  return done([`${MESSAGE_PREFIX} recorded ${ledger.calls.length} calls for ${workflow} in ${runFileLabel(slug)}`]);
}

function ingest(positional: string[], deps: Deps): Outcome {
  const [slug = "", workflow = "", ...dirs] = positional;
  if (dirs.length === 0) return usage("ingest needs <slug> <workflow> and one or more transcript directories");
  const badName = checkNames(slug, workflow);
  if (badName !== null) return fail(badName);
  const journals: Journal[] = [];
  for (const dir of dirs) {
    const text = deps.readFile(join(dir, JOURNAL_FILE_NAME));
    if (text === null) return fail(`no ${JOURNAL_FILE_NAME} in ${dir}`);
    journals.push({ dir, text });
  }
  const file = loadRunFile(deps, slug);
  if (typeof file === "string") return fail(file);
  const base = file ?? emptyRunFile(slug);
  const known = base.workflows[workflow]?.calls ?? null;
  const readSoft = (path: string): string | null => {
    try {
      return deps.readFile(path);
    } catch {
      return null;
    }
  };
  const result = ingestJournals(known, journals, readSoft);
  const next: RunFile = { ...base, workflows: { ...base.workflows, [workflow]: { calls: result.calls } } };
  saveRunFile(deps, next);
  return done([
    `${MESSAGE_PREFIX} ${result.withTokens} of ${result.calls.length} calls now have tokens; ${result.added} journal entries had no ledger call and were added`,
  ]);
}

function summary(positional: string[], markdown: boolean, deps: Deps): Outcome {
  const [slug = ""] = positional;
  if (positional.length !== 1) return usage("summary needs <slug>");
  if (!isValidSlug(slug)) return fail(`slug "${slug}" must be lower-case words joined by dashes`);
  const file = loadRunFile(deps, slug);
  if (typeof file === "string") return fail(file);
  if (file === null) return fail(`no ${runFileLabel(slug)}; nothing was recorded for ${slug}`);
  return done(summaryLines(file, markdown));
}

function stats(positional: string[], parsed: Parsed, deps: Deps): Outcome {
  if (positional.length !== 0) return usage("stats takes no positional arguments");
  const dir = parsed.dir ?? VERIFY_DIR;
  const base = isAbsolute(dir) ? dir : join(deps.root, dir);
  const runs: RunFile[] = [];
  const warnings: string[] = [];
  for (const entry of deps.listDir(base).sort()) {
    let text: string | null;
    try {
      text = deps.readFile(join(base, entry, RUN_FILE_NAME));
    } catch (e) {
      warnings.push(`${MESSAGE_PREFIX} skipped ${entry}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (text === null) continue;
    const file = parseRunFile(text);
    if (typeof file === "string") warnings.push(`${MESSAGE_PREFIX} skipped ${entry}/${RUN_FILE_NAME}: ${file}`);
    else runs.push(file);
  }
  if (runs.length === 0) return { code: EXIT_OK, stdout: [`${MESSAGE_PREFIX} no ${RUN_FILE_NAME} files in ${dir}`], stderr: warnings };
  return { code: EXIT_OK, stdout: statsLines(runs, parsed.markdown), stderr: warnings };
}

export function run(argv: string[], deps: Deps): Outcome {
  const [verb = "", ...args] = argv;
  const flags: Record<string, string[]> = {
    [VERB_RECORD]: [],
    [VERB_INGEST]: [],
    [VERB_SUMMARY]: [FLAG_MARKDOWN],
    [VERB_STATS]: [FLAG_MARKDOWN, FLAG_DIR],
  };
  const allowed = flags[verb];
  if (allowed === undefined) return usage(verb === "" ? "a verb is required" : `unknown verb "${verb}"`);
  const parsed = parseArgs(args, allowed);
  if (typeof parsed === "string") return usage(parsed);
  try {
    if (verb === VERB_RECORD) return record(parsed.positional, deps);
    if (verb === VERB_INGEST) return ingest(parsed.positional, deps);
    if (verb === VERB_SUMMARY) return summary(parsed.positional, parsed.markdown, deps);
    return stats(parsed.positional, parsed, deps);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export const defaultDeps: Deps = {
  root: join(dirname(fileURLToPath(import.meta.url)), ".."),
  readStdin: () => readFileSync(0, "utf8"),
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch (e) {
      if (e instanceof Error && "code" in e && MISSING_FILE_CODES.includes(e.code)) return null;
      throw e;
    }
  },
  writeFile: (path, text) => writeFileSync(path, text),
  mkdirp: (path) => void mkdirSync(path, { recursive: true }),
  listDir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
};

if (import.meta.main) {
  const outcome = run(process.argv.slice(2), defaultDeps);
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  process.exit(outcome.code);
}
