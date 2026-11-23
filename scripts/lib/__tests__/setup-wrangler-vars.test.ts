import { describe, expect, it } from "vitest";
import { applyVarEdits, isProvisioned, missingBlocks, preserveVars, varNames, varsOf, type WranglerConfig } from "../setup-wrangler-vars";
import { buildWranglerConfig, DUMMY_INPUT } from "../wrangler-config";

const fresh = buildWranglerConfig({ ...DUMMY_INPUT, dbId: "11111111-1111-1111-1111-111111111111" }) as WranglerConfig;

const withVars: WranglerConfig = {
  ...fresh,
  vars: { BETTER_AUTH_URL: "https://app.example.com" },
  env: {
    preview: { vars: { BETTER_AUTH_URL: "https://preview.example.com", AUTH_TRUSTED_ORIGINS: "https://a.example.com" } },
    staging: {},
  },
};

describe("preserveVars", () => {
  it("keeps every variable already set, at the top and in each environment (#144)", () => {
    const next = preserveVars(withVars, fresh);
    expect(varsOf(next, "production")).toEqual({ BETTER_AUTH_URL: "https://app.example.com" });
    expect(varsOf(next, "preview")).toEqual({ BETTER_AUTH_URL: "https://preview.example.com", AUTH_TRUSTED_ORIGINS: "https://a.example.com" });
    expect(varsOf(next, "staging")).toEqual({});
  });

  it("takes the new resource ids from the fresh config", () => {
    expect(preserveVars(withVars, fresh).d1_databases).toEqual(fresh.d1_databases);
  });

  it("returns the fresh config when there is nothing to keep", () => {
    expect(preserveVars(null, fresh)).toBe(fresh);
    expect(varsOf(preserveVars(fresh, fresh), "production")).toEqual({});
  });
});

describe("applyVarEdits", () => {
  it("changes only the named variable and leaves the rest alone", () => {
    const next = applyVarEdits(withVars, [{ environment: "preview", name: "BETTER_AUTH_URL", value: "https://new.example.com" }]);
    expect(varsOf(next, "preview")).toEqual({ BETTER_AUTH_URL: "https://new.example.com", AUTH_TRUSTED_ORIGINS: "https://a.example.com" });
    expect(varsOf(next, "production")).toEqual(varsOf(withVars, "production"));
    expect(next.d1_databases).toEqual(withVars.d1_databases);
  });

  it("does not change the config it was given", () => {
    applyVarEdits(withVars, [{ environment: "production", name: "X", value: "1" }]);
    expect(varsOf(withVars, "production")).toEqual({ BETTER_AUTH_URL: "https://app.example.com" });
  });

  it("reports an environment that has no block", () => {
    expect(missingBlocks({ name: "x" }, [{ environment: "staging", name: "X", value: "1" }])).toEqual(["staging"]);
    expect(missingBlocks(withVars, [{ environment: "staging", name: "X", value: "1" }])).toEqual([]);
  });
});

describe("varNames and isProvisioned", () => {
  it("lists names only", () => {
    expect([...varNames(withVars, "preview")].sort()).toEqual(["AUTH_TRUSTED_ORIGINS", "BETTER_AUTH_URL"]);
    expect(varNames(null, "production").size).toBe(0);
  });

  it("calls the committed placeholder unprovisioned and a config with real ids provisioned", () => {
    expect(isProvisioned(buildWranglerConfig(DUMMY_INPUT) as WranglerConfig)).toBe(false);
    expect(isProvisioned(fresh)).toBe(true);
    expect(isProvisioned(null)).toBe(false);
  });
});
