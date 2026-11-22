import { Either } from "effect";
import { E2E_DIR, E2E_SPEC, SOURCE_FILE, TEST_MAP_PATH } from "../lint/constants";
import { globToRegExp } from "../lint/test-map/glob";
import { importsFile } from "../lint/test-map/imports";
import { parseTestMap, type TestMap } from "../lint/test-map/map";
import { specsVisiting } from "../lint/test-map/route";
import type { Repo } from "../lint/types";
import {
  COMMAND,
  FIELD,
  FULL_RUN_TRIGGERS,
  GATE,
  LINE,
  MACHINE_SUFFIX,
  MODULE_FILE,
  NO_MAP_REASON,
  PATHS_SPEC_SUFFIX,
  SHELL_QUOTE,
  SHELL_QUOTE_ESCAPED,
  SKIP_REASON,
  UNSAFE_PATH,
  UNSAFE_PATH_REASON,
} from "./verify-plan-constants";

interface Step {
  gate: string;
  command: string;
}

interface Skip {
  gate: string;
  reason: string;
}

export type Plan = { kind: "full"; reasons: string[] } | { kind: "lean"; run: Step[]; skip: Skip[] };

const triggers = FULL_RUN_TRIGGERS.map((trigger) => ({ ...trigger, pattern: globToRegExp(trigger.match) }));

export const shellQuote = (word: string): string =>
  `${SHELL_QUOTE}${word.split(SHELL_QUOTE).join(SHELL_QUOTE_ESCAPED)}${SHELL_QUOTE}`;

const withArgs = (command: string, paths: readonly string[]): string => [command, ...paths.map(shellQuote)].join(" ");

export function fullRunReasons(changed: readonly string[]): string[] {
  return changed.flatMap((path) => {
    if (UNSAFE_PATH.test(path)) return [UNSAFE_PATH_REASON];
    const trigger = triggers.find(({ pattern }) => pattern.test(path));
    return trigger ? [`${path}: ${trigger.reason}`] : [];
  });
}

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

function specsFor(repo: Repo, map: TestMap, path: string, specs: readonly string[]): string[] {
  const found = new Set<string>();
  if (E2E_SPEC.test(path)) found.add(path);
  const entry = map.classify(path);
  if (entry?.kind === "covered-by" && entry.test && E2E_SPEC.test(entry.test)) found.add(entry.test);
  if (entry?.kind === "machine") found.add(`${E2E_DIR}/${fileName(path).replace(MACHINE_SUFFIX, "")}${PATHS_SPEC_SUFFIX}`);
  if (entry?.kind === "route") for (const spec of specsVisiting(repo, path)) found.add(spec);
  for (const spec of specs) {
    const source = repo.source(spec);
    if (source && importsFile(source, path)) found.add(spec);
  }
  return [...found].filter((spec) => repo.read(spec) !== undefined);
}

export function e2eSpecsFor(repo: Repo, map: TestMap, changed: readonly string[]): string[] {
  const specs = repo.files(E2E_DIR).filter((path) => E2E_SPEC.test(path));
  return [...new Set(changed.flatMap((path) => specsFor(repo, map, path, specs)))].sort();
}

export function planChanged(repo: Repo, changed: readonly string[]): Plan {
  const reasons = fullRunReasons(changed);
  if (reasons.length > 0) return { kind: "full", reasons: [...new Set(reasons)] };
  const parsed = parseTestMap(repo.read(TEST_MAP_PATH) ?? "");
  if (Either.isLeft(parsed)) return { kind: "full", reasons: [NO_MAP_REASON] };
  const present = changed.filter((path) => repo.read(path) !== undefined);
  const code = present.filter((path) => SOURCE_FILE.test(path));
  const specs = e2eSpecsFor(repo, parsed.right, present);
  const run: Step[] = [{ gate: GATE.typecheck, command: COMMAND.typecheck }];
  const skip: Skip[] = [];
  const modules = present.filter((path) => MODULE_FILE.test(path));
  if (code.length > 0) run.push({ gate: GATE.lint, command: withArgs(COMMAND.lint, code) });
  else skip.push({ gate: GATE.lint, reason: SKIP_REASON.noCode });
  if (modules.length > 0) run.push({ gate: GATE.test, command: withArgs(COMMAND.test, modules) });
  else skip.push({ gate: GATE.test, reason: SKIP_REASON.noModule });
  if (specs.length > 0) run.push({ gate: GATE.e2e, command: withArgs(COMMAND.e2e, specs) });
  else skip.push({ gate: GATE.e2e, reason: SKIP_REASON.noSpec });
  return { kind: "lean", run, skip };
}

export function renderPlan(plan: Plan): string[] {
  if (plan.kind === "full") return plan.reasons.map((reason) => [LINE.full, reason].join(FIELD));
  return [
    ...plan.run.map((step) => [LINE.run, step.gate, step.command].join(FIELD)),
    ...plan.skip.map((skip) => [LINE.skip, skip.gate, skip.reason].join(FIELD)),
  ];
}
