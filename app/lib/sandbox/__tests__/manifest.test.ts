import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { SCENARIO_NAMES } from "@/lib/constants/fixtures";
import { getScenario } from "@/lib/fixtures/scenarios";
import { buildManifest, caseUrl } from "../manifest";
import { SANDBOX_MODULES } from "../modules";
import { readSandboxQuery, resolveSelection } from "../resolve";

const scenarios = Effect.runSync(Effect.forEach(SCENARIO_NAMES, getScenario));
const manifest = buildManifest(SANDBOX_MODULES, scenarios);

describe("buildManifest", () => {
  it("lists every scenario with its user count taken from the fixtures, never a copied number", () => {
    expect(manifest.scenarios).toEqual(
      scenarios.map((scenario) => ({
        name: scenario.name,
        description: scenario.description,
        users: scenario.users.length,
      })),
    );
  });

  it("holds no fixture row: no email, id or password reaches the JSON", () => {
    const text = JSON.stringify(manifest);
    expect(text).not.toMatch(/@preview\.local|seed-|password/i);
  });

  it("lists every module and case, with one key and one URL per declared scenario", () => {
    expect(manifest.modules.map((module) => module.id)).toEqual(
      SANDBOX_MODULES.map((module) => module.id),
    );
    for (const entry of manifest.modules.flatMap((module) => module.cases)) {
      expect(entry.caseKeys).toHaveLength(entry.scenarios.length);
      expect(entry.urls).toHaveLength(entry.scenarios.length);
    }
  });

  it("gives each URL that resolves to exactly the frame its key names, so an agent can open any case alone", () => {
    for (const entry of manifest.modules.flatMap((module) => module.cases)) {
      entry.urls.forEach((url, index) => {
        const view = Either.getOrThrow(
          Effect.runSync(
            Effect.either(
              resolveSelection(readSandboxQuery(new URL(url, "http://x")), SANDBOX_MODULES),
            ),
          ),
        );
        expect(view.items.map((item) => item.caseKey)).toEqual([entry.caseKeys[index]]);
      });
    }
  });

  it("marks the module that needs an admin and leaves the field off the others", () => {
    const [users, upload] = manifest.modules;
    expect(users?.needsRole).toBe("admin");
    expect(upload).not.toHaveProperty("needsRole");
  });
});

describe("caseUrl", () => {
  it("escapes its values, so a case id can never add a query param of its own", () => {
    expect(caseUrl("file-upload", "idle&lng=zh", "base")).toBe(
      "/sandbox?module=file-upload&case=idle%26lng%3Dzh&scenario=base",
    );
  });
});
