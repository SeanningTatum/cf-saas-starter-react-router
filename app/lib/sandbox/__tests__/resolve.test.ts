import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { SCENARIO_NAMES } from "@/lib/constants/fixtures";
import { SANDBOX_MODULES, type SandboxModuleMeta } from "../modules";
import { readSandboxQuery, resolveSelection, type SandboxQuery } from "../resolve";

const query = (fields: Partial<SandboxQuery> = {}): SandboxQuery => ({
  lng: "en",
  theme: "light",
  ...fields,
});

const resolve = (
  fields: Partial<SandboxQuery>,
  modules: ReadonlyArray<SandboxModuleMeta> = SANDBOX_MODULES,
) => Effect.runSync(Effect.either(resolveSelection(query(fields), modules)));

const pairs = SANDBOX_MODULES.flatMap((module) =>
  module.cases.flatMap((entry) => entry.scenarios.map((scenario) => ({ module, entry, scenario }))),
);

describe("readSandboxQuery", () => {
  it("reads module, case, scenario, lng and theme from the URL", () => {
    const url = new URL(
      "http://x/sandbox?module=users-table&case=list&scenario=base&lng=zh&theme=dark",
    );
    expect(readSandboxQuery(url)).toEqual({
      module: "users-table",
      case: "list",
      scenario: "base",
      lng: "zh",
      theme: "dark",
    });
  });

  it("falls back to en and light for a missing or unknown lng or theme, so a typo never breaks the render", () => {
    expect(readSandboxQuery(new URL("http://x/sandbox?lng=fr&theme=sepia"))).toMatchObject({
      lng: "en",
      theme: "light",
    });
    expect(readSandboxQuery(new URL("http://x/sandbox"))).toMatchObject({
      lng: "en",
      theme: "light",
    });
  });

  it("reads an empty module param as no module, so ?module= shows every module", () => {
    expect(readSandboxQuery(new URL("http://x/sandbox?module=")).module).toBeUndefined();
  });
});

describe("resolveSelection", () => {
  it("with no module lists every declared module, case and scenario once", () => {
    const view = Either.getOrThrow(resolve({}));
    expect(view.kind).toBe("all");
    expect(view.items).toHaveLength(pairs.length);
    expect(new Set(view.items.map((item) => item.caseKey)).size).toBe(pairs.length);
  });

  it("with only a scenario keeps the pairs that declare it and skips the rest", () => {
    const view = Either.getOrThrow(resolve({ scenario: "empty" }));
    expect(view.items).toHaveLength(pairs.filter((pair) => pair.scenario === "empty").length);
    expect(view.items.every((item) => item.scenario === "empty")).toBe(true);
  });

  it("with a module and case and scenario gives exactly that frame, carrying lng and theme", () => {
    const view = Either.getOrThrow(
      resolve({
        module: "users-table",
        case: "list",
        scenario: "many-users",
        lng: "zh",
        theme: "dark",
      }),
    );
    expect(view).toMatchObject({ kind: "single", lng: "zh", theme: "dark" });
    expect(view.items.map((item) => item.caseKey)).toEqual(["users-table:list:many-users"]);
  });

  it("with a module alone gives every case of it under every scenario each declares", () => {
    const view = Either.getOrThrow(resolve({ module: "users-table" }));
    expect(view.items.map((item) => item.caseKey)).toEqual([
      "users-table:list:base",
      "users-table:list:many-users",
      "users-table:empty:empty",
    ]);
  });

  it("fails an unknown module with SandboxUnknownModuleError listing the valid ids", () => {
    const error = Either.flip(resolve({ module: "users-tabel" }));
    expect(Either.getOrThrow(error)).toMatchObject({
      _tag: "SandboxUnknownModuleError",
      moduleId: "users-tabel",
      valid: SANDBOX_MODULES.map((module) => module.id),
    });
  });

  it("fails an unknown scenario with SandboxUnknownScenarioError listing every scenario", () => {
    expect(Either.getOrThrow(Either.flip(resolve({ scenario: "huge" })))).toMatchObject({
      _tag: "SandboxUnknownScenarioError",
      valid: SCENARIO_NAMES,
    });
  });

  it("fails an unknown case with SandboxCaseNotDeclaredError naming the module's cases", () => {
    expect(
      Either.getOrThrow(Either.flip(resolve({ module: "file-upload", case: "busy" }))),
    ).toMatchObject({
      _tag: "SandboxCaseNotDeclaredError",
      moduleId: "file-upload",
      caseId: "busy",
      validCases: ["idle"],
    });
  });

  it("fails a case with a scenario it does not declare, naming the scenarios it fits", () => {
    expect(
      Either.getOrThrow(
        Either.flip(resolve({ module: "users-table", case: "empty", scenario: "base" })),
      ),
    ).toMatchObject({
      _tag: "SandboxCaseNotDeclaredError",
      scenario: "base",
      validScenarios: ["empty"],
    });
  });

  it("with an empty registry gives an all view with no items, the fresh-fork state", () => {
    expect(Either.getOrThrow(resolve({}, [])).items).toEqual([]);
  });
});
