import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { isScenarioName } from "@/lib/fixtures/scenarios";
import { SANDBOX_MODULES, SandboxModuleId, caseKey } from "../modules";

describe("SANDBOX_MODULES", () => {
  it("holds each module id once, and every id is a SandboxModuleId, so a URL names one module", () => {
    const ids = SANDBOX_MODULES.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(Schema.is(SandboxModuleId))).toBe(true);
  });

  it("gives every module at least one case, with ids unique inside the module", () => {
    for (const module of SANDBOX_MODULES) {
      const ids = module.cases.map((entry) => entry.id);
      expect(ids.length, module.id).toBeGreaterThan(0);
      expect(new Set(ids).size, module.id).toBe(ids.length);
    }
  });

  it("declares only real scenarios, at least one per case, so every case has a frame to render", () => {
    for (const entry of SANDBOX_MODULES.flatMap((module) => module.cases)) {
      expect(entry.scenarios.length, entry.id).toBeGreaterThan(0);
      expect(entry.scenarios.every(isScenarioName), entry.id).toBe(true);
    }
  });
});

describe("caseKey", () => {
  it("joins module, case and scenario, the id the sweep reads from data-case", () => {
    expect(caseKey("users-table", "list", "many-users")).toBe("users-table:list:many-users");
  });

  it("gives every module, case and scenario a different key", () => {
    const keys = SANDBOX_MODULES.flatMap((module) =>
      module.cases.flatMap((entry) => entry.scenarios.map((s) => caseKey(module.id, entry.id, s))),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
