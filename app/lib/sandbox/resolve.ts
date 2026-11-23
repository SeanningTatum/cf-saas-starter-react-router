import { Effect, Option, Schema } from "effect";
import { SCENARIO_NAMES } from "@/lib/constants/fixtures";
import {
  SANDBOX_DEFAULT_LOCALE,
  SANDBOX_DEFAULT_THEME,
  SANDBOX_LOCALES,
  SANDBOX_QUERY,
  SANDBOX_THEMES,
} from "@/lib/constants/sandbox";
import { SANDBOX_RESOLVE_SELECTION_SPAN } from "@/lib/constants/spans";
import { isScenarioName } from "@/lib/fixtures/scenarios";
import type { ScenarioName } from "@/lib/fixtures/schema";
import {
  SandboxCaseNotDeclaredError,
  type SandboxSelectionError,
  SandboxUnknownModuleError,
  SandboxUnknownScenarioError,
} from "@/models/errors/sandbox";
import {
  caseKey,
  type SandboxCaseMeta,
  type SandboxModuleId,
  type SandboxModuleMeta,
} from "./modules";

export const SandboxLocale = Schema.Literal(...SANDBOX_LOCALES);
export type SandboxLocale = typeof SandboxLocale.Type;
export const SandboxTheme = Schema.Literal(...SANDBOX_THEMES);
export type SandboxTheme = typeof SandboxTheme.Type;

export interface SandboxQuery {
  readonly module?: string;
  readonly case?: string;
  readonly scenario?: string;
  readonly lng: SandboxLocale;
  readonly theme: SandboxTheme;
}

export interface SandboxItem {
  readonly moduleId: SandboxModuleId;
  readonly caseId: string;
  readonly scenario: ScenarioName;
  readonly caseKey: string;
}

export interface SandboxView {
  readonly kind: "all" | "single";
  readonly items: ReadonlyArray<SandboxItem>;
  readonly lng: SandboxLocale;
  readonly theme: SandboxTheme;
}

const param = (url: URL, key: string): string | undefined => url.searchParams.get(key) || undefined;

const pick = <A extends string>(
  schema: Schema.Schema<A>,
  raw: string | undefined,
  fallback: A,
): A => Option.getOrElse(Schema.decodeUnknownOption(schema)(raw), () => fallback);

export const readSandboxQuery = (url: URL): SandboxQuery => ({
  module: param(url, SANDBOX_QUERY.module),
  case: param(url, SANDBOX_QUERY.case),
  scenario: param(url, SANDBOX_QUERY.scenario),
  lng: pick(SandboxLocale, param(url, SANDBOX_QUERY.lng), SANDBOX_DEFAULT_LOCALE),
  theme: pick(SandboxTheme, param(url, SANDBOX_QUERY.theme), SANDBOX_DEFAULT_THEME),
});

const declared = (cases: ReadonlyArray<SandboxCaseMeta>): ReadonlyArray<ScenarioName> => [
  ...new Set(cases.flatMap((entry) => entry.scenarios)),
];

const itemsOf = (
  module: SandboxModuleMeta,
  cases: ReadonlyArray<SandboxCaseMeta>,
  scenario: ScenarioName | undefined,
): ReadonlyArray<SandboxItem> =>
  cases.flatMap((entry) =>
    entry.scenarios
      .filter((name) => scenario === undefined || name === scenario)
      .map((name) => ({
        moduleId: module.id,
        caseId: entry.id,
        scenario: name,
        caseKey: caseKey(module.id, entry.id, name),
      })),
  );

const readScenario = (
  raw: string | undefined,
): Effect.Effect<ScenarioName | undefined, SandboxUnknownScenarioError> => {
  if (raw === undefined || isScenarioName(raw)) return Effect.succeed(raw);
  return Effect.fail(new SandboxUnknownScenarioError({ scenario: raw, valid: SCENARIO_NAMES }));
};

const findModule = (
  modules: ReadonlyArray<SandboxModuleMeta>,
  raw: string,
): Effect.Effect<SandboxModuleMeta, SandboxUnknownModuleError> => {
  const found = modules.find((module) => module.id === raw);
  if (found) return Effect.succeed(found);
  return Effect.fail(
    new SandboxUnknownModuleError({ moduleId: raw, valid: modules.map((module) => module.id) }),
  );
};

const selectCases = (
  module: SandboxModuleMeta,
  caseId: string | undefined,
  scenario: ScenarioName | undefined,
): Effect.Effect<ReadonlyArray<SandboxCaseMeta>, SandboxCaseNotDeclaredError> => {
  const cases =
    caseId === undefined ? module.cases : module.cases.filter((entry) => entry.id === caseId);
  const fits = scenario === undefined || cases.some((entry) => entry.scenarios.includes(scenario));
  if (cases.length > 0 && fits) return Effect.succeed(cases);
  return Effect.fail(
    new SandboxCaseNotDeclaredError({
      moduleId: module.id,
      caseId,
      scenario,
      validCases: module.cases.map((entry) => entry.id),
      validScenarios: declared(cases.length > 0 ? cases : module.cases),
    }),
  );
};

export const resolveSelection = (
  query: SandboxQuery,
  modules: ReadonlyArray<SandboxModuleMeta>,
): Effect.Effect<SandboxView, SandboxSelectionError> =>
  Effect.gen(function* () {
    const scenario = yield* readScenario(query.scenario);
    const { lng, theme } = query;
    if (query.module === undefined) {
      const items = modules.flatMap((module) => itemsOf(module, module.cases, scenario));
      return { kind: "all" as const, items, lng, theme };
    }
    const module = yield* findModule(modules, query.module);
    const cases = yield* selectCases(module, query.case, scenario);
    return { kind: "single" as const, items: itemsOf(module, cases, scenario), lng, theme };
  }).pipe(Effect.withSpan(SANDBOX_RESOLVE_SELECTION_SPAN));
