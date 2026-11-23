import { Effect } from "effect";
import { SCENARIO_NAMES } from "@/lib/constants/fixtures";
import { SANDBOX_STATUS } from "@/lib/constants/sandbox";
import { SANDBOX_LOAD_MANIFEST_SPAN, SANDBOX_LOAD_PAGE_SPAN } from "@/lib/constants/spans";
import { getScenario } from "@/lib/fixtures/scenarios";
import type { Scenario, ScenarioName } from "@/lib/fixtures/schema";
import type { FixtureValidationError } from "@/models/errors/fixture";
import type { SandboxError, SandboxSelectionError } from "@/models/errors/sandbox";
import { checkSandboxEnabled, type SandboxEnv } from "./gate";
import { buildManifest, type SandboxManifest } from "./manifest";
import { SANDBOX_MODULES } from "./modules";
import { readSandboxQuery, resolveSelection, type SandboxView } from "./resolve";

type SandboxStatus = (typeof SANDBOX_STATUS)[keyof typeof SANDBOX_STATUS];

export type SandboxPageData =
  | {
      readonly kind: "ok";
      readonly view: SandboxView;
      readonly scenarios: Partial<Record<ScenarioName, Scenario>>;
    }
  | { readonly kind: "disabled" }
  | {
      readonly kind: "invalid";
      readonly tag: SandboxError["_tag"];
      readonly message: string;
      readonly validModules: ReadonlyArray<string>;
      readonly validScenarios: ReadonlyArray<string>;
      readonly validCases?: ReadonlyArray<string>;
    }
  | { readonly kind: "broken-fixture"; readonly message: string };

export interface SandboxPageResult {
  readonly status: SandboxStatus;
  readonly body: SandboxPageData;
}

export interface SandboxManifestResult {
  readonly status: SandboxStatus;
  readonly body: SandboxManifest | null;
}

export interface SandboxLoadArgs {
  readonly env: SandboxEnv;
  readonly built: boolean;
}

const moduleIds = SANDBOX_MODULES.map((module) => module.id);

const invalidMessage = (error: SandboxSelectionError): string => {
  switch (error._tag) {
    case "SandboxUnknownModuleError":
      return `No module named ${error.moduleId}`;
    case "SandboxUnknownScenarioError":
      return `No scenario named ${error.scenario}`;
    case "SandboxCaseNotDeclaredError":
      return error.caseId !== undefined && !error.validCases.includes(error.caseId)
        ? `${error.moduleId} has no case named ${error.caseId}`
        : `${error.moduleId} does not declare scenario ${error.scenario}. It fits: ${error.validScenarios.join(", ")}`;
  }
};

const invalid = (error: SandboxSelectionError): SandboxPageResult => ({
  status: SANDBOX_STATUS.notFound,
  body: {
    kind: "invalid",
    tag: error._tag,
    message: invalidMessage(error),
    validModules: error._tag === "SandboxUnknownModuleError" ? error.valid : moduleIds,
    validScenarios:
      error._tag === "SandboxUnknownScenarioError"
        ? error.valid
        : error._tag === "SandboxCaseNotDeclaredError"
          ? error.validScenarios
          : SCENARIO_NAMES,
    ...(error._tag === "SandboxCaseNotDeclaredError" ? { validCases: error.validCases } : {}),
  },
});

const brokenFixture = (error: FixtureValidationError): SandboxPageResult => ({
  status: SANDBOX_STATUS.brokenFixture,
  body: { kind: "broken-fixture", message: error.message },
});

const scenariosOf = (view: SandboxView) =>
  Effect.forEach([...new Set(view.items.map((item) => item.scenario))], getScenario).pipe(
    Effect.map((loaded) => Object.fromEntries(loaded.map((scenario) => [scenario.name, scenario]))),
  );

export const loadSandboxPage = (
  args: SandboxLoadArgs & { readonly url: URL },
): Effect.Effect<SandboxPageResult> =>
  Effect.gen(function* () {
    yield* checkSandboxEnabled(args.env, args.built);
    const view = yield* resolveSelection(readSandboxQuery(args.url), SANDBOX_MODULES);
    const scenarios = yield* scenariosOf(view);
    return { status: SANDBOX_STATUS.ok, body: { kind: "ok" as const, view, scenarios } };
  }).pipe(
    Effect.catchTags({
      SandboxDisabledError: () =>
        Effect.succeed({ status: SANDBOX_STATUS.notFound, body: { kind: "disabled" as const } }),
      SandboxUnknownModuleError: (error) => Effect.succeed(invalid(error)),
      SandboxUnknownScenarioError: (error) => Effect.succeed(invalid(error)),
      SandboxCaseNotDeclaredError: (error) => Effect.succeed(invalid(error)),
      FixtureValidationError: (error) => Effect.succeed(brokenFixture(error)),
    }),
    Effect.withSpan(SANDBOX_LOAD_PAGE_SPAN),
  );

export const loadSandboxManifest = (args: SandboxLoadArgs): Effect.Effect<SandboxManifestResult> =>
  Effect.gen(function* () {
    yield* checkSandboxEnabled(args.env, args.built);
    const scenarios = yield* Effect.forEach(SCENARIO_NAMES, getScenario);
    return { status: SANDBOX_STATUS.ok, body: buildManifest(SANDBOX_MODULES, scenarios) };
  }).pipe(
    Effect.catchTags({
      SandboxDisabledError: () => Effect.succeed({ status: SANDBOX_STATUS.notFound, body: null }),
      FixtureValidationError: () =>
        Effect.succeed({ status: SANDBOX_STATUS.brokenFixture, body: null }),
    }),
    Effect.withSpan(SANDBOX_LOAD_MANIFEST_SPAN),
  );
