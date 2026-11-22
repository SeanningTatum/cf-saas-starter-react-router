import { Either } from "effect";
import {
  EXIT_BAD_CONFIG,
  EXIT_OK,
  EXIT_USAGE,
  GATE_FIELD_SEPARATOR,
  KEY_SEPARATOR,
  MESSAGE_PREFIX,
  MISSING_GATES_LINE,
  USAGE_TEXT,
  VERB_CHECK,
  VERB_GATES,
  VERB_GET,
  VERB_SHOW,
} from "./lib/harness-config-constants";
import {
  configChecksum,
  HARNESS_ROOT,
  loadHarnessConfig,
  readDiskFile,
  shownConfig,
  type HarnessConfig,
  type LoadDeps,
} from "./lib/harness-config";

export type Deps = LoadDeps;

export interface Outcome {
  code: number;
  stdout: string[];
  stderr: string[];
}

const done = (stdout: string[]): Outcome => ({ code: EXIT_OK, stdout, stderr: [] });
const fail = (line: string): Outcome => ({ code: EXIT_BAD_CONFIG, stdout: [], stderr: [line] });
const usage = (why: string): Outcome => ({ code: EXIT_USAGE, stdout: [], stderr: [`${MESSAGE_PREFIX} ${why}`, USAGE_TEXT] });

const hasKey = (value: object, key: string): boolean => Object.hasOwn(value, key);

function lookup(config: HarnessConfig, dotted: string): { found: true; value: unknown } | { found: false } {
  let current: unknown = config;
  for (const part of dotted.split(KEY_SEPARATOR)) {
    if (typeof current !== "object" || current === null || !hasKey(current, part)) return { found: false };
    current = Reflect.get(current, part);
  }
  return { found: true, value: current };
}

const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function printValue(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (isTextList(value)) return value;
  return [JSON.stringify(value)];
}

function show(config: HarnessConfig): Outcome {
  const shown = shownConfig(config);
  return done([JSON.stringify({ config: shown, check: configChecksum(shown) })]);
}

function get(config: HarnessConfig, positional: string[]): Outcome {
  const [dotted = ""] = positional;
  if (positional.length !== 1) return usage("get needs one <dotted.key>");
  const found = lookup(config, dotted);
  if (!found.found) return fail(`${MESSAGE_PREFIX} no key "${dotted}" in the config`);
  return done(printValue(found.value));
}

function gates(config: HarnessConfig): Outcome {
  if (config.gates.length === 0) return fail(`${MESSAGE_PREFIX} ${MISSING_GATES_LINE}`);
  const lines = config.gates.map((gate) => [gate.name, gate.run, gate.tier, gate.limitSeconds].join(GATE_FIELD_SEPARATOR));
  return done(lines);
}

export function run(argv: string[], deps: Deps): Outcome {
  const [verb = "", ...positional] = argv;
  const known = [VERB_SHOW, VERB_GET, VERB_GATES, VERB_CHECK];
  if (!known.includes(verb)) return usage(verb === "" ? "a verb is required" : `unknown verb "${verb}"`);
  const loaded = loadHarnessConfig(deps);
  if (Either.isLeft(loaded)) return fail(loaded.left);
  const config = loaded.right;
  if (verb === VERB_GET) return get(config, positional);
  if (positional.length !== 0) return usage(`${verb} takes no arguments`);
  if (verb === VERB_SHOW) return show(config);
  if (verb === VERB_GATES) return gates(config);
  return done([`${MESSAGE_PREFIX} ok (${config.gates.length} gates)`]);
}

export const defaultDeps: Deps = { root: HARNESS_ROOT, readFile: readDiskFile };

if (import.meta.main) {
  const outcome = run(process.argv.slice(2), defaultDeps);
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  process.exit(outcome.code);
}
