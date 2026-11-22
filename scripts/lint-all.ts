#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Either, Schema } from "effect";
import {
  BIOME_BIN,
  EXIT,
  HOUSE_SCRIPT,
  IMPORT_CYCLE_RULE,
  KNIP_BIN,
  LEGACY_HOUSE_CHECKER,
  LEGACY_HOUSE_SCOPE,
  LINTABLE_FILE,
  MAX_OUTPUT_BYTES,
  PACKAGE_FILE,
  SPAWN_FAILED_STATUS,
  STAGED_FILES_ARGS,
  TOOL,
} from "./lib/lint-constants";
import {
  type Finding,
  formatFinding,
  parseBiome,
  parseHouse,
  parseKnip,
  parseLegacyHouse,
  sortFindings,
} from "./lib/lint-findings";

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface Deps {
  run: (command: string, args: readonly string[]) => RunResult;
  readFile: (file: string) => string | undefined;
  exists: (file: string) => boolean;
  print: (line: string) => void;
  printError: (line: string) => void;
}

interface ToolOutcome {
  tool: string;
  findings: Finding[];
  error?: string;
}

export interface Request {
  staged: boolean;
  fix: boolean;
  files: string[];
}

export function parseArgs(argv: readonly string[]): Request {
  return {
    staged: argv.includes("--staged"),
    fix: argv.includes("--fix"),
    files: argv.filter((arg) => !arg.startsWith("--")).map((file) => path.posix.normalize(file)),
  };
}

const PackageScripts = Schema.parseJson(
  Schema.Struct({
    scripts: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  }),
);

function hasHouseScript(deps: Deps): boolean {
  const decoded = Schema.decodeUnknownEither(PackageScripts)(deps.readFile(PACKAGE_FILE) ?? "");
  return Either.isRight(decoded) && decoded.right.scripts?.[HOUSE_SCRIPT] !== undefined;
}

function stagedFiles(deps: Deps): Either.Either<string[], string> {
  const listed = deps.run("git", STAGED_FILES_ARGS);
  if (listed.status !== 0)
    return Either.left(`git could not list the staged files: ${listed.stderr.trim()}`);
  return Either.right(listed.stdout.split("\n").filter((file) => file !== "" && deps.exists(file)));
}

function biomeOutcome(tool: string, result: RunResult): ToolOutcome {
  const parsed = parseBiome(result.stdout);
  if (Either.isLeft(parsed)) {
    return { tool, findings: [], error: `${parsed.left}. ${result.stderr.trim()}` };
  }
  if (result.status !== 0 && parsed.right.length === 0) {
    return { tool, findings: [], error: `biome failed with no finding. ${result.stderr.trim()}` };
  }
  return { tool, findings: parsed.right };
}

function runBiome(deps: Deps, request: Request, files: readonly string[]): ToolOutcome {
  const targets = request.staged ? ["--staged"] : files.length > 0 ? files : ["."];
  return biomeOutcome(
    TOOL.biome,
    deps.run(BIOME_BIN, [
      "check",
      "--reporter=json",
      "--max-diagnostics=none",
      "--error-on-warnings",
      "--no-errors-on-unmatched",
      ...(request.fix ? ["--write"] : []),
      "--",
      ...targets,
    ]),
  );
}

function runImportCycles(deps: Deps): ToolOutcome {
  return biomeOutcome(
    TOOL.importCycles,
    deps.run(BIOME_BIN, [
      "lint",
      `--only=${IMPORT_CYCLE_RULE}`,
      "--reporter=json",
      "--max-diagnostics=none",
      "--error-on-warnings",
      ".",
    ]),
  );
}

function runHouse(deps: Deps, scoped: boolean, files: readonly string[]): ToolOutcome {
  if (hasHouseScript(deps)) {
    const result = deps.run("bun", ["run", HOUSE_SCRIPT, ...(scoped ? files : [])]);
    const findings = parseHouse(`${result.stdout}\n${result.stderr}`);
    if (result.status !== 0 && findings.length === 0) {
      return {
        tool: TOOL.house,
        findings,
        error: `the house linter failed with no finding. ${result.stderr.trim()}`,
      };
    }
    return { tool: TOOL.house, findings };
  }
  if (scoped && !files.some((file) => LEGACY_HOUSE_SCOPE.test(file)))
    return { tool: TOOL.house, findings: [] };
  const result = deps.run("bun", ["run", LEGACY_HOUSE_CHECKER]);
  const all = parseLegacyHouse(`${result.stdout}\n${result.stderr}`);
  if (result.status !== 0 && all.length === 0) {
    return {
      tool: TOOL.house,
      findings: all,
      error: `the house linter failed with no finding. ${result.stderr.trim()}`,
    };
  }
  const wanted = new Set(files);
  return {
    tool: TOOL.house,
    findings: scoped ? all.filter((finding) => wanted.has(finding.path)) : all,
  };
}

function runDeadCode(deps: Deps): ToolOutcome {
  const result = deps.run(KNIP_BIN, ["--no-progress", "--reporter", "json"]);
  const jsonLine = result.stdout.split("\n").find((line) => line.startsWith("{")) ?? "";
  const parsed = parseKnip(jsonLine);
  if (Either.isLeft(parsed)) {
    return { tool: TOOL.deadCode, findings: [], error: `${parsed.left}. ${result.stderr.trim()}` };
  }
  if (result.status !== 0 && parsed.right.length === 0) {
    return {
      tool: TOOL.deadCode,
      findings: [],
      error: `knip failed with no finding. ${result.stderr.trim()}`,
    };
  }
  return { tool: TOOL.deadCode, findings: parsed.right };
}

export function lint(argv: readonly string[], deps: Deps): number {
  const request = parseArgs(argv);
  const staged = request.staged ? stagedFiles(deps) : Either.right<string[]>([]);
  if (Either.isLeft(staged)) {
    deps.printError(`error: ${staged.left}`);
    return EXIT.toolFailed;
  }
  const scoped = request.staged || request.files.length > 0;
  const files = (request.staged ? staged.right : request.files).filter((file) =>
    LINTABLE_FILE.test(file),
  );
  if (scoped && files.length === 0) {
    deps.print("lint: clean (no file to check)");
    return EXIT.clean;
  }

  const outcomes = [runBiome(deps, request, files), runHouse(deps, scoped, files)];
  if (!scoped) outcomes.push(runImportCycles(deps), runDeadCode(deps));

  for (const outcome of outcomes) {
    for (const finding of sortFindings(outcome.findings)) deps.print(formatFinding(finding));
  }
  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  for (const outcome of failed)
    deps.printError(`error: ${outcome.tool} could not run: ${outcome.error}`);

  const counts = outcomes.map((outcome) => `${outcome.tool} ${outcome.findings.length}`).join(", ");
  const total = outcomes.reduce((sum, outcome) => sum + outcome.findings.length, 0);
  if (failed.length > 0) {
    deps.printError(
      `lint: ${failed.length} tool(s) could not run, which is a failure, not a pass (${counts})`,
    );
    return EXIT.toolFailed;
  }
  if (total > 0) {
    deps.printError(`lint: ${total} finding(s) (${counts})`);
    return EXIT.findings;
  }
  deps.print(`lint: clean (${counts})`);
  return EXIT.clean;
}

export function realDeps(): Deps {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  return {
    run: (command, args) => {
      const result = spawnSync(command, [...args], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      if (result.error) {
        return {
          status: SPAWN_FAILED_STATUS,
          stdout: "",
          stderr: `cannot run ${command}: ${result.error.message}`,
        };
      }
      return {
        status: result.status ?? EXIT.findings,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
    readFile: (file) => {
      const full = path.join(root, file);
      return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : undefined;
    },
    exists: (file) => fs.existsSync(path.join(root, file)),
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
  };
}

if (import.meta.main) {
  process.exit(lint(process.argv.slice(2), realDeps()));
}
