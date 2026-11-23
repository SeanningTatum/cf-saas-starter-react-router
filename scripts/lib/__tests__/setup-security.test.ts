import { describe, expect, it } from "vitest";
import type { Outcome } from "../../repo-rules";
import { authSecretLength, renderSecurity, runSecurityPass } from "../setup-security";
import { newWorld, worldRunner, type World } from "./helpers/setup-world";

const rulesOk = (world: World) => (): Outcome => {
  world.environments.add("production");
  return { code: 0, stdout: ["did: PUT environments/production"], stderr: [] };
};

const byId = (world: World, applyRules: () => Outcome) =>
  Object.fromEntries(runSecurityPass({ run: worldRunner(world), applyRules }).map((entry) => [entry.id, entry]));

describe("runSecurityPass", () => {
  it("applies what is off and says so", () => {
    const world = newWorld();
    const results = byId(world, rulesOk(world));
    expect(Object.values(results).map((entry) => entry.status)).toEqual(["applied", "applied", "applied", "applied"]);
    expect(world.settings).toEqual({ alerts: true, scanning: true, reports: true });
  });

  it("writes nothing when the settings are already on: a second run makes no change", () => {
    const world = newWorld();
    world.settings = { alerts: true, scanning: true, reports: true };
    const results = byId(world, rulesOk(world));
    expect(results["dependency-alerts"]?.status).toBe("already");
    expect(results["secret-scanning"]?.status).toBe("already");
    expect(results["private-reports"]?.status).toBe("already");
    expect(world.calls.flatMap((call) => call.args).some((arg) => arg === "PUT" || arg === "PATCH")).toBe(false);
  });

  it("lists what it could not apply instead of failing the run", () => {
    const world = newWorld();
    world.denySettings = true;
    const results = byId(world, () => ({ code: 1, stdout: [], stderr: ["error: PUT failed (403)"] }));
    expect(Object.values(results).every((entry) => entry.status === "left")).toBe(true);
    expect(results["repo-rules"]?.detail).toContain("repo-rules.ts --apply");
    const lines = renderSecurity(Object.values(results));
    expect(lines.at(-1)).toMatch(/Left for you/);
  });

  it("sends the secret-scanning change as a JSON body on standard input", () => {
    const world = newWorld();
    byId(world, rulesOk(world));
    const patch = world.calls.find((call) => call.args.includes("PATCH"));
    expect(JSON.parse(patch?.input ?? "{}")).toEqual({
      security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } },
    });
  });
});

describe("authSecretLength", () => {
  it("reports a secret set in this run as checked", () => {
    expect(authSecretLength({ authSecretsSet: ["auth-secret"], authSecretsKept: false }).status).toBe("applied");
  });

  it("says an older secret cannot be measured and names the way to replace it", () => {
    const result = authSecretLength({ authSecretsSet: [], authSecretsKept: true });
    expect(result.status).toBe("left");
    expect(result.detail).toContain("--rotate-auth-secret");
  });
});
