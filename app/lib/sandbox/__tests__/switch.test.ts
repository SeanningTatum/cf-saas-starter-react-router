import { describe, expect, it } from "vitest";
import { sandboxBuildOn, sandboxWorkerVars } from "../switch";

describe("sandboxBuildOn", () => {
  it.each([
    { name: "local dev (the Vite dev server)", env: { DEV: true }, on: true },
    { name: "a preview build (VITE_SANDBOX=1)", env: { DEV: false, VITE_SANDBOX: "1" }, on: true },
    { name: "a production or staging build (no flag)", env: { DEV: false }, on: false },
    {
      name: "a build with the flag set to anything but 1",
      env: { DEV: false, VITE_SANDBOX: "true" },
      on: false,
    },
    { name: "a build with the flag empty", env: { DEV: false, VITE_SANDBOX: "" }, on: false },
  ])(
    "is $on for $name, so only dev and previews ever register the sandbox routes",
    ({ env, on }) => {
      expect(sandboxBuildOn(env)).toBe(on);
    },
  );

  it("is off when DEV is a truthy string, not the boolean Vite sets, so a stray env value cannot turn it on", () => {
    expect(sandboxBuildOn({ DEV: "1" as unknown as boolean })).toBe(false);
  });
});

describe("sandboxWorkerVars", () => {
  it("sets SANDBOX_ENABLED to 1 on the Worker of a sandbox build, which the run-time gate reads", () => {
    expect(sandboxWorkerVars(true)).toEqual({ SANDBOX_ENABLED: "1" });
  });

  it("adds no var to any other build, so a production Worker never carries the flag", () => {
    expect(sandboxWorkerVars(false)).toEqual({});
  });
});
