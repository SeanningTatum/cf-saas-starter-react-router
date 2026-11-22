import { describe, expect, it } from "vitest";
import { ROUTES_FILE } from "../../constants";
import { memoryRepo } from "../../repo";
import { routeProblems, visitsPath } from "../route";

const table = () => 'import { route } from "@react-router/dev/routes";\nexport default [route("/users", "routes/users.tsx")];\n';

const spec = (body: string) => `import { test, expect } from "@playwright/test";\n${body}\n`;

const tagged = (target: string, assertion = "expect(1).toBe(1);") =>
  spec(
    `test("works", { tag: "@golden" }, async ({ page }) => { await page.goto("${target}"); ${assertion} });\n` +
      `test("fails well", { tag: "@error" }, async ({ page }) => { await page.goto("${target}"); ${assertion} });`
  );

const repoWith = (specs: Record<string, string>) =>
  memoryRepo({ [ROUTES_FILE]: table(), "app/routes/users.tsx": "export default function Users() { return null; }\n", ...specs });

describe("visitsPath", () => {
  it.each([
    ["/users", true],
    ["/users?tab=1", true],
    ["/users#top", true],
    ["/users/7", false],
    ["/user", false],
    ["/", false],
  ])("a visit to %s counts for /users: %s", (visited, expected) => {
    expect(visitsPath(visited, "/users")).toBe(expected);
  });
});

describe("routeProblems", () => {
  it("is clean when one spec holds both tags, asserts, and visits the path", () => {
    expect(routeProblems(repoWith({ "e2e/users.spec.ts": tagged("/users") }), "app/routes/users.tsx")).toEqual([]);
  });

  it("does not count a tagged spec that asserts nothing, since a visit alone proves no behaviour", () => {
    const problems = routeProblems(repoWith({ "e2e/users.spec.ts": tagged("/users", "") }), "app/routes/users.tsx");

    expect(problems).toHaveLength(1);
  });

  it("does not add up tags from one spec and a visit from another", () => {
    const repo = repoWith({
      "e2e/tags.spec.ts": tagged("/elsewhere"),
      "e2e/visit.spec.ts": spec('test("opens", async ({ page }) => { await page.goto("/users"); expect(1).toBe(1); });'),
    });

    expect(routeProblems(repo, "app/routes/users.tsx")).toHaveLength(1);
  });

  it("ignores a file under e2e that is not a spec", () => {
    expect(routeProblems(repoWith({ "e2e/helpers.ts": tagged("/users") }), "app/routes/users.tsx")).toHaveLength(1);
  });

  it("reads each repo's specs once and keeps repos apart, so a cached answer never leaks between runs", () => {
    const proven = repoWith({ "e2e/users.spec.ts": tagged("/users") });
    const unproven = repoWith({});

    expect(routeProblems(proven, "app/routes/users.tsx")).toEqual([]);
    expect(routeProblems(unproven, "app/routes/users.tsx")).toHaveLength(1);
    expect(routeProblems(proven, "app/routes/users.tsx")).toEqual([]);
  });
});
