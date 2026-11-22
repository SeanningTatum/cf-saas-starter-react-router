#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { readAtBase, resolveBase, type BaseDeps } from "./base-ref";
import { applyBaseline, BASELINE_CHECKS, baselineFinding, baselineSize, compareWithBase, parseBaseline, type Baseline } from "./baseline";
import { BASELINE_PATH, GH_TIMEOUT_MS, LINT_ROOTS, RULES_PAGE, SHORT_SHA_LENGTH, USAGE } from "./constants";
import { formatFinding } from "./format";
import { loadRules, type Registry } from "./registry";
import { diskRepo } from "./repo";
import { applyRules, checkPage, renderRules } from "./rules-page";
import { runRules } from "./run";
import { selftest } from "./selftest";
import type { Finding, Outcome, Repo } from "./types";

export interface CliDeps extends BaseDeps {
  root: string;
  cwd: string;
  repo: Repo;
  registry: Registry;
  writeFile(path: string, text: string): void;
}

const MODES = ["--rules", "--selftest", "--write-docs", "--check-docs"];
const HELP_FLAGS = ["--help", "-h"];

const ok = (...stdout: string[]): Outcome => ({ code: 0, stdout, stderr: [] });
const failed = (stderr: string[], code = 1): Outcome => ({ code, stdout: [], stderr });

function ratchet(deps: CliDeps, head: Baseline): { findings: Finding[]; note: string } {
  const base = resolveBase(deps);
  if (!base.found) {
    const tried = base.tried.join(", ") || "none named";
    if (!base.required) return { findings: [], note: `no base branch found (tried: ${tried}), so only checked that every entry applies` };
    const message = `cannot read the base branch (${tried}), so the shrink-only check did not run`;
    return { findings: [baselineFinding(BASELINE_CHECKS.base, message)], note: "" };
  }
  const where = `${base.sha.slice(0, SHORT_SHA_LENGTH)} (${base.from})`;
  const text = readAtBase(deps.git, base.sha, BASELINE_PATH);
  if (text === undefined) return { findings: [], note: `${where} has no baseline yet, so every entry here is new` };
  return Either.match(parseBaseline(text), {
    onLeft: () => ({ findings: [], note: `the baseline at ${where} does not parse, so it was not compared` }),
    onRight: (atBase) => ({ findings: compareWithBase(atBase, head), note: `compared with ${where}` }),
  });
}

function toRepoPaths(deps: CliDeps, files: string[]): Set<string> {
  const inside = files
    .map((file) => relative(deps.root, resolve(deps.cwd, file)).split(sep).join("/"))
    .filter((path) => path !== "" && !path.startsWith(".."));
  return new Set(inside);
}

function check(deps: CliDeps, files: string[]): Outcome {
  const { rules } = deps.registry;
  const only = files.length > 0 ? toRepoPaths(deps, files) : undefined;
  const missing = [...(only ?? [])].filter((path) => deps.repo.read(path) === undefined);
  if (missing.length > 0) {
    return failed(missing.map((path) => `no such file: ${path}. Pass paths that exist; a deleted file needs no check.`), 2);
  }
  const text = deps.repo.read(BASELINE_PATH);
  const parsed =
    text === undefined
      ? Either.left(baselineFinding(BASELINE_CHECKS.shape, `${BASELINE_PATH} is missing`, 'create it with `{ "suppressions": 0, "boundaries": {}, "debt": {} }`'))
      : parseBaseline(text);
  if (Either.isLeft(parsed)) return failed([formatFinding(parsed.left), "house lint: 1 finding."]);
  const baseline = parsed.right;
  const run = runRules(rules, deps.repo, LINT_ROOTS, only);
  const ruleIds = rules.map((rule) => rule.id);
  const compared = only ? { findings: [], note: "" } : ratchet(deps, baseline);
  const findings = [...applyBaseline(baseline, run, ruleIds, only), ...compared.findings];
  if (findings.length > 0) {
    return failed([...findings.map(formatFinding), `house lint: ${findings.length} finding(s). Each line says the fix.`]);
  }
  const size = baselineSize(baseline);
  const scope = `${run.filesChecked} file(s), ${rules.length} rule(s)`;
  if (only) return ok(`house lint: clean. ${scope}.`);
  return ok(
    `house lint: clean. ${scope}. Baseline: ${size.debt} finding(s) in debt, ${size.boundaries} boundary file(s), ${baseline.suppressions} suppression(s); ${compared.note}.`
  );
}

function docs(deps: CliDeps, write: boolean): Outcome {
  const table = renderRules(deps.registry.rules);
  const page = deps.repo.read(RULES_PAGE);
  const state = checkPage(page, table);
  if (state.fresh) return ok(`${RULES_PAGE} matches the ${deps.registry.rules.length} rule(s) in scripts/lint/rules/`);
  const next = page === undefined ? undefined : applyRules(page, table);
  if (!write || next === undefined) return failed([state.problem]);
  deps.writeFile(RULES_PAGE, next);
  return ok(`wrote the rule table to ${RULES_PAGE}`);
}

export function lint(argv: string[], deps: CliDeps): Outcome {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const files = argv.filter((arg) => !arg.startsWith("-"));
  if (flags.some((flag) => HELP_FLAGS.includes(flag))) return ok(...USAGE);
  const unknown = flags.find((flag) => !MODES.includes(flag));
  if (unknown || flags.length > 1 || (flags.length === 1 && files.length > 0)) {
    return failed([unknown ? `unknown option: ${unknown}` : "pass one option, or file paths, not both", ...USAGE], 2);
  }
  const { rules, problems } = deps.registry;
  const [mode] = flags;
  if (mode === "--selftest") {
    const result = selftest(rules, (path) => deps.repo.read(path) !== undefined);
    const failures = [...problems, ...result.failures];
    if (failures.length > 0) return failed([...failures, `house lint selftest: ${failures.length} failure(s)`]);
    return ok(`house lint selftest: ok. ${result.cases} case(s) over ${result.rules} rule(s).`);
  }
  if (problems.length > 0) return failed(problems);
  if (mode === "--rules") return ok(renderRules(rules));
  if (mode === "--write-docs" || mode === "--check-docs") return docs(deps, mode === "--write-docs");
  return check(deps, files);
}

function runCommand(root: string, command: string, args: string[], timeout?: number): string | undefined {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const outcome = lint(argv, {
    root,
    cwd: process.cwd(),
    repo: diskRepo(root),
    registry: await loadRules(),
    env: process.env,
    git: (args) => runCommand(root, "git", args),
    pullRequestTarget: () =>
      runCommand(root, "gh", ["pr", "view", "--json", "baseRefName", "--jq", ".baseRefName"], GH_TIMEOUT_MS) || undefined,
    writeFile: (path, text) => writeFileSync(join(root, path), text),
  });
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  return outcome.code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
