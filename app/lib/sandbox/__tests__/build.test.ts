import type { RouteConfigEntry } from "@react-router/dev/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

const MANIFEST_FILE = "routes/sandbox/manifest.ts";

const loadFresh = async () => {
  vi.resetModules();
  const build = await import("../build");
  const routes = await import("@/routes");
  return {
    built: build.SANDBOX_BUILD,
    files: routes.default.map((entry: RouteConfigEntry) => entry.file),
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SANDBOX_BUILD and the route table", () => {
  it("local dev: the build flag is on and app/routes.ts registers /sandbox.json", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_SANDBOX", undefined);
    const { built, files } = await loadFresh();
    expect(built).toBe(true);
    expect(files).toContain(MANIFEST_FILE);
  });

  it("preview: a production-mode build with VITE_SANDBOX=1 registers /sandbox.json", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_SANDBOX", "1");
    const { built, files } = await loadFresh();
    expect(built).toBe(true);
    expect(files).toContain(MANIFEST_FILE);
  });

  it("production: with no flag the route table holds no sandbox route, so its module is never bundled", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_SANDBOX", undefined);
    const { built, files } = await loadFresh();
    expect(built).toBe(false);
    expect(files.filter((file) => file.startsWith("routes/sandbox/"))).toEqual([]);
  });
});
