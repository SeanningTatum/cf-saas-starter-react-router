import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTES_FILE } from "../../constants";
import { diskRepo } from "../../repo";
import { sourceOf } from "../../__tests__/fixtures";
import { routePaths } from "../routes";

const HEAD = 'import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";\n';

const pathsOf = (table: string): Record<string, string[]> =>
  Object.fromEntries(routePaths(sourceOf(`${HEAD}export default ${table};\n`, ROUTES_FILE)));

describe("routePaths", () => {
  it("a top-level index is / and a top-level route keeps its own path", () => {
    expect(pathsOf('[index("routes/home.tsx"), route("/login", "routes/login.tsx")]')).toEqual({
      "app/routes/home.tsx": ["/"],
      "app/routes/login.tsx": ["/login"],
    });
  });

  it("a route under a prefix joins with no double slash and no trailing slash", () => {
    expect(pathsOf('[...prefix("admin", [route("/", "routes/admin/_index.tsx"), route("/users/", "routes/admin/users.tsx")])]')).toEqual({
      "app/routes/admin/_index.tsx": ["/admin"],
      "app/routes/admin/users.tsx": ["/admin/users"],
    });
  });

  it("a layout gets the path it wraps and its children keep that base", () => {
    const table = '[...prefix("admin", [layout("routes/admin/_layout.tsx", [index("routes/admin/_index.tsx"), route("users", "routes/admin/users.tsx")])])]';

    expect(pathsOf(table)).toEqual({
      "app/routes/admin/_layout.tsx": ["/admin"],
      "app/routes/admin/_index.tsx": ["/admin"],
      "app/routes/admin/users.tsx": ["/admin/users"],
    });
  });

  it("a top-level layout wraps /", () => {
    expect(pathsOf('[layout("routes/_layout.tsx", [route("/about", "routes/about.tsx")])]')).toEqual({
      "app/routes/_layout.tsx": ["/"],
      "app/routes/about.tsx": ["/about"],
    });
  });

  it("a route's own children nest under its path, after an options object", () => {
    expect(pathsOf('[route("/users", "routes/users.tsx", { id: "users" }, [index("routes/users-list.tsx"), route(":id", "routes/user.tsx")])]')).toEqual({
      "app/routes/users.tsx": ["/users"],
      "app/routes/users-list.tsx": ["/users"],
      "app/routes/user.tsx": ["/users/:id"],
    });
  });

  it("a file listed twice, plainly and under a locale prefix, gets both paths in table order", () => {
    const table = '[index("routes/home.tsx"), route("/login", "routes/login.tsx"), ...prefix(":lng", [index("routes/home.tsx", { id: "lng-home" }), route("/login", "routes/login.tsx", { id: "lng-login" })])]';

    expect(pathsOf(table)).toEqual({
      "app/routes/home.tsx": ["/", "/:lng"],
      "app/routes/login.tsx": ["/login", "/:lng/login"],
    });
  });

  it("reads the table through satisfies, as and parentheses", () => {
    const expected = { "app/routes/home.tsx": ["/"] };

    expect(pathsOf('[index("routes/home.tsx")] satisfies RouteConfig')).toEqual(expected);
    expect(pathsOf('([index("routes/home.tsx")] as RouteConfig)')).toEqual(expected);
  });

  it("skips a call that is not a route helper, and an entry whose file is not a string literal", () => {
    expect(pathsOf('[...flatRoutes(), route("/x", FILE), route("/y", "routes/y.tsx")]')).toEqual({ "app/routes/y.tsx": ["/y"] });
  });

  it("gives an empty map when the default export is not an array literal", () => {
    expect(routePaths(sourceOf(`${HEAD}const routes = [index("routes/home.tsx")];\nexport default routes;\n`, ROUTES_FILE)).size).toBe(0);
    expect(routePaths(sourceOf(`${HEAD}export const routes = [index("routes/home.tsx")];\n`, ROUTES_FILE)).size).toBe(0);
  });
});

describe("routePaths on the real app/routes.ts", () => {
  it("finds the admin users page under its prefix and the home page at /", () => {
    const table = diskRepo(fileURLToPath(new URL("../../../../", import.meta.url))).source(ROUTES_FILE);
    const paths = table ? routePaths(table) : new Map<string, string[]>();

    expect(paths.get("app/routes/admin/users.tsx")).toEqual(["/admin/users"]);
    expect(paths.get("app/routes/home.tsx")).toContain("/");
  });
});
