import { expect, test } from "@playwright/test";
import { SANDBOX_MODULE_IDS } from "../app/lib/constants/sandbox";
import { SCENARIO_NAMES } from "../app/lib/constants/fixtures";

test.describe("Sandbox manifest (issue #47): /sandbox.json, served only by local dev and preview builds", () => {
  test("GET /sandbox.json answers 200 JSON listing every module, case URL and scenario, uncached and unindexed, so an agent can find every case to open", {
    tag: "@golden",
  }, async ({ page }) => {
    const response = await page.goto("/sandbox.json");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("application/json");
    expect(response?.headers()["cache-control"]).toBe("no-store");
    expect(response?.headers()["x-robots-tag"]).toBe("noindex");

    const body = await response?.json();
    expect(body.version).toBe(1);
    expect(body.modules.map((module: { id: string }) => module.id)).toEqual([
      ...SANDBOX_MODULE_IDS,
    ]);
    expect(body.scenarios.map((scenario: { name: string }) => scenario.name)).toEqual([
      ...SCENARIO_NAMES,
    ]);
    for (const entry of body.modules.flatMap((module: { cases: unknown[] }) => module.cases)) {
      expect(entry.urls).toHaveLength(entry.scenarios.length);
      for (const url of entry.urls)
        expect(url).toMatch(/^\/sandbox\?module=[\w-]+&case=[\w-]+&scenario=[\w-]+$/);
    }
    expect(JSON.stringify(body), "the manifest leaked a fixture row").not.toMatch(
      /@preview\.local|seed-/,
    );
  });

  test("a POST to /sandbox.json is refused with 405 and an empty body, so the route only reads", {
    tag: "@error",
  }, async ({ request }) => {
    const response = await request.post("/sandbox.json", { data: {} });
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe("GET, HEAD");
    expect(await response.text()).toBe("");
  });
});
