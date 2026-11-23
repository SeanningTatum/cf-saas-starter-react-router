import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENARIO_NAMES } from "@/lib/constants/fixtures";
import { loadSandboxManifest, loadSandboxPage } from "../loader";
import { SANDBOX_MODULES } from "../modules";

const broken = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/fixtures/scenarios", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/fixtures/scenarios")>();
  const { Effect: E } = await import("effect");
  const { FixtureValidationError } = await import("@/models/errors/fixture");
  return {
    ...real,
    getScenario: (name: Parameters<typeof real.getScenario>[0]) =>
      broken.on
        ? E.fail(new FixtureValidationError({ scenario: name, message: "planted bad fixture" }))
        : real.getScenario(name),
  };
});

afterEach(() => {
  broken.on = false;
});

const ON = { env: { SANDBOX_ENABLED: "1" }, built: true } as const;
const page = (search: string, args: { env: { SANDBOX_ENABLED?: string }; built: boolean } = ON) =>
  Effect.runPromise(loadSandboxPage({ ...args, url: new URL(`http://x/sandbox${search}`) }));

describe("loadSandboxManifest", () => {
  it.each([
    { name: "a build without the flag", args: { env: { SANDBOX_ENABLED: "1" }, built: false } },
    { name: "a Worker without SANDBOX_ENABLED", args: { env: {}, built: true } },
  ])("answers 404 with no body for $name, so nothing reveals the route", async ({ args }) => {
    expect(await Effect.runPromise(loadSandboxManifest(args))).toEqual({ status: 404, body: null });
  });

  it("answers 200 with every module and scenario when the gate is open", async () => {
    const result = await Effect.runPromise(loadSandboxManifest(ON));
    expect(result.status).toBe(200);
    expect(result.body?.modules.map((module) => module.id)).toEqual(
      SANDBOX_MODULES.map((module) => module.id),
    );
    expect(result.body?.scenarios.map((scenario) => scenario.name)).toEqual(SCENARIO_NAMES);
  });

  it("answers 500 with no body when a fixture fails to decode, never a half manifest", async () => {
    broken.on = true;
    expect(await Effect.runPromise(loadSandboxManifest(ON))).toEqual({ status: 500, body: null });
  });
});

describe("loadSandboxPage", () => {
  it("answers 404 kind disabled when the gate is shut, before it reads the query", async () => {
    expect(await page("?module=nope", { env: {}, built: true })).toEqual({
      status: 404,
      body: { kind: "disabled" },
    });
  });

  it("answers 200 with the view and only the scenarios its frames use", async () => {
    const result = await page("?module=users-table&case=empty&scenario=empty&lng=zh");
    expect(result.status).toBe(200);
    if (result.body.kind !== "ok") throw new Error(`expected ok, got ${result.body.kind}`);
    expect(result.body.view.lng).toBe("zh");
    expect(Object.keys(result.body.scenarios)).toEqual(["empty"]);
    expect(result.body.scenarios.empty?.users).toEqual([]);
  });

  it("answers 404 kind invalid for an unknown module, with every valid module and scenario to link to", async () => {
    expect(await page("?module=users-tabel")).toEqual({
      status: 404,
      body: {
        kind: "invalid",
        tag: "SandboxUnknownModuleError",
        message: "No module named users-tabel",
        validModules: SANDBOX_MODULES.map((module) => module.id),
        validScenarios: SCENARIO_NAMES,
      },
    });
  });

  it("answers 404 kind invalid for an unknown scenario, naming it", async () => {
    expect((await page("?scenario=huge")).body).toMatchObject({
      kind: "invalid",
      tag: "SandboxUnknownScenarioError",
      message: "No scenario named huge",
    });
  });

  it("answers 404 for an undeclared pair, naming the scenarios the module fits and its cases", async () => {
    expect(await page("?module=users-table&case=empty&scenario=base")).toEqual({
      status: 404,
      body: {
        kind: "invalid",
        tag: "SandboxCaseNotDeclaredError",
        message: "users-table does not declare scenario base. It fits: empty",
        validModules: SANDBOX_MODULES.map((module) => module.id),
        validScenarios: ["empty"],
        validCases: ["list", "empty"],
      },
    });
  });

  it("answers 404 for an unknown case, naming the module's cases", async () => {
    expect((await page("?module=file-upload&case=busy")).body).toMatchObject({
      message: "file-upload has no case named busy",
      validCases: ["idle"],
    });
  });

  it("answers 500 kind broken-fixture when a fixture fails to decode", async () => {
    broken.on = true;
    expect(await page("?module=file-upload")).toEqual({
      status: 500,
      body: { kind: "broken-fixture", message: "planted bad fixture" },
    });
  });
});
