import ts from "typescript";
import { CONSTANTS_DIR, ROUTES_FILE, ROUTE_CONSTANTS_FILE } from "../constants";
import { isOwnShippedSource, lineOf, walkNodes } from "../source";
import { routePaths } from "../test-map/routes";
import type { FileHit, FileRule, Repo } from "../types";

const ROOT_PATH = "/";
const DYNAMIC_SEGMENT = /[:*]/;
const WILDCARD_TAIL = /\/\*$/;

const pathsByRepo = new WeakMap<Repo, Set<string>>();

function registeredPaths(repo: Repo): Set<string> {
  const known = pathsByRepo.get(repo);
  if (known) return known;
  const table = repo.source(ROUTES_FILE);
  const all = table ? [...routePaths(table).values()].flat() : [];
  const fixed = all.map((path) => path.replace(WILDCARD_TAIL, "")).filter((path) => path !== ROOT_PATH && !DYNAMIC_SEGMENT.test(path));
  const paths = new Set(fixed);
  pathsByRepo.set(repo, paths);
  return paths;
}

const TABLE =
  'import { index, prefix, route } from "@react-router/dev/routes";\n' +
  'export default [index("routes/home.tsx"), route("/login", "routes/login.tsx"), route("/api/trpc/*", "routes/api/trpc.ts"), ' +
  '...prefix("admin", [route("/users", "routes/admin/users.tsx"), route("/users/:id", "routes/admin/user.tsx")])];\n';

const withTable = (files: Record<string, string>): Record<string, string> => ({ [ROUTES_FILE]: TABLE, ...files });

export const rule: FileRule = {
  id: "route-paths",
  scope: "file",
  matches: `A string equal to a path registered in \`${ROUTES_FILE}\`, written anywhere but the route constants. Paths with a parameter and the root path \`/\` are not matched.`,
  covers: `\`app/\` and \`workers/\`, except \`${ROUTES_FILE}\`, \`${CONSTANTS_DIR}\`, tests and the ShadCN primitives in \`app/components/ui/\`.`,
  fix: `import the path from \`${ROUTE_CONSTANTS_FILE}\` (\`ROUTES.login\`, \`API_ROUTES.uploadFile\`); add it there first if the route is new`,
  example: ROUTE_CONSTANTS_FILE,
  applies: (path) => isOwnShippedSource(path) && path !== ROUTES_FILE && !path.startsWith(CONSTANTS_DIR),
  check({ ast }, repo) {
    const registered = registeredPaths(repo);
    const hits: FileHit[] = [];
    walkNodes(ast, (node) => {
      if (!ts.isStringLiteralLike(node) || !registered.has(node.text)) return;
      hits.push({ line: lineOf(ast, node), message: `the route path "${node.text}" is written inline` });
    });
    return hits;
  },
  cases: [
    { name: "a registered path in a redirect is caught", files: withTable({ "app/routes/home.tsx": 'export const go = () => redirect("/login");\n' }), expect: "finding" },
    { name: "a registered path in a JSX attribute is caught", files: withTable({ "app/components/nav.tsx": 'export const Nav = () => <a href="/admin/users">Users</a>;\n' }), expect: "finding" },
    { name: "a registered path in a template with no substitution is caught", files: withTable({ "app/lib/nav.ts": "export const to = `/login`;\n" }), expect: "finding" },
    { name: "a wildcard route is matched by its fixed part", files: withTable({ "app/lib/client.ts": 'export const endpoint = "/api/trpc";\n' }), expect: "finding" },
    { name: "a worker file is inside the rule", files: withTable({ "workers/app.ts": 'export const login = "/login";\n' }), expect: "finding" },
    { name: "a path the table does not register is fine", files: withTable({ "app/lib/nav.ts": 'export const docs = "/docs";\n' }), expect: "clean" },
    { name: "the root path is not matched, since a bare slash means many things", files: withTable({ "app/lib/nav.ts": 'export const sep = "/";\n' }), expect: "clean" },
    { name: "a path with a parameter is not matched", files: withTable({ "app/lib/nav.ts": 'export const user = "/admin/users/:id";\n' }), expect: "clean" },
    { name: "a longer string that only contains a path is fine", files: withTable({ "app/lib/nav.ts": 'export const note = "go to /login first";\n' }), expect: "clean" },
    { name: "the route constants are where paths live", files: withTable({ [ROUTE_CONSTANTS_FILE]: 'export const ROUTES = { login: "/login" } as const;\n' }), expect: "clean" },
    { name: "the route table itself is outside the rule", files: withTable({}), expect: "clean" },
    { name: "a test file is outside the rule", files: withTable({ "app/lib/__tests__/nav.test.ts": 'export const to = "/login";\n' }), expect: "clean" },
  ],
};
