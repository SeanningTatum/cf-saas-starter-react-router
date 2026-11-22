import { LEVELS_FILE, ROUTES_FILE, TEST_MAP_PATH } from "../constants";
import type { Case } from "../types";

type Files = Record<string, string>;
type Entry = { match: string; kind: string; test?: string; reason?: string };

const mapped = (entries: Entry[], files: Files): Files => ({ [TEST_MAP_PATH]: JSON.stringify({ entries }), ...files });

const HELPER = "export function helper(a: number) { return a + 1; }\n";
const REAL_TEST =
  'import { describe, it, expect } from "vitest";\n' +
  'import { helper } from "../helper";\n' +
  'describe("helper", () => { it("adds", () => { expect(helper(1)).toBe(2); }); });\n';
const UNIT = [{ match: "app/lib/**", kind: "unit" }];
const unit = (test: string): Files => mapped(UNIT, { "app/lib/helper.ts": HELPER, "app/lib/__tests__/helper.test.ts": test });

const MACHINE = [{ match: "app/**/*.machine.ts", kind: "machine" }];
const MACHINE_FILE = 'import { setup } from "xstate";\nexport const doorMachine = setup({}).createMachine({});\n';
const MACHINE_TEST =
  'import { expect, it } from "vitest";\nimport { doorMachine } from "../door.machine";\nit("starts closed", () => { expect(doorMachine.id).toBeDefined(); });\n';
const PATHS_SPEC =
  'import { test, expect } from "@playwright/test";\nimport { doorPaths } from "@/components/door.model";\ntest("opens", async () => { expect(doorPaths).toBeDefined(); });\n';
const machine = (extra: Files): Files =>
  mapped(MACHINE, { "app/components/door.machine.ts": MACHINE_FILE, "app/components/__tests__/door.machine.test.ts": MACHINE_TEST, ...extra });

const PROCEDURE = [{ match: "app/trpc/routes/**", kind: "procedure" }];
const ROUTER =
  'import { adminProcedure, createTRPCRouter } from "..";\nexport const notesRouter = createTRPCRouter({ list: adminProcedure.query(() => []) });\n';
const LEVELS = 'const LEVELS: Record<string, string> = { "notes.list": "admin" };\nexport { LEVELS };\n';
const PROCEDURE_TEST =
  'import { expect, it } from "vitest";\nimport { appRouter } from "@/trpc/router";\nit("lists", async () => { expect(await caller(appRouter).notes.list()).toEqual([]); });\n';
const procedure = (levels: string, extra: Files): Files =>
  mapped(PROCEDURE, { "app/trpc/routes/notes.ts": ROUTER, [LEVELS_FILE]: levels, ...extra });

const TABLE_SPEC = "e2e/table.spec.ts";
const ROUTE = [
  { match: "app/routes.ts", kind: "covered-by", test: TABLE_SPEC, reason: "The route table; every visit resolves through it." },
  { match: "app/routes/**", kind: "route" },
];
const ROUTE_TABLE =
  'import { layout, prefix, route } from "@react-router/dev/routes";\n' +
  'export default [...prefix("admin", [layout("routes/admin/_layout.tsx", [route("/users", "routes/admin/users.tsx")])])] satisfies RouteConfig;\n';
const PAGE = "export default function Page() { return null; }\n";
const smokeSpec = (target: string, tags: string[]): string =>
  'import { test, expect } from "@playwright/test";\n' +
  tags.map((tag) => `test("flow ${tag}", { tag: "${tag}" }, async ({ page }) => { await page.goto(${target}); expect(1).toBe(1); });\n`).join("");
const route = (extra: Files, table = ROUTE_TABLE): Files =>
  mapped(ROUTE, {
    "app/routes/admin/users.tsx": PAGE,
    [ROUTES_FILE]: table,
    [TABLE_SPEC]: 'import { test, expect } from "@playwright/test";\ntest("boots", async () => { expect(1).toBe(1); });\n',
    ...extra,
  });

const BUTTON = "export function Button() { return null; }\n";
const component = (kind: string, extra: Files): Files =>
  mapped([{ match: "app/components/**", kind }, { match: "app/routes/sandbox/**", kind: "declaration" }], {
    "app/components/button.tsx": BUTTON,
    ...extra,
  });

const coveredBy = (test: Files): Files =>
  mapped([{ match: "app/entry.client.tsx", kind: "covered-by", test: "e2e/home.spec.ts", reason: "The browser entry; every spec loads through it." }], {
    "app/entry.client.tsx": "hydrate();\n",
    ...test,
  });

export const testMapCases: Case[] = [
  { name: "a file no entry matches is unclassified", files: mapped(UNIT, { "app/lib/helper.ts": HELPER, "app/lib/__tests__/helper.test.ts": REAL_TEST, "app/new-folder/thing.ts": HELPER }), expect: "finding" },
  { name: "a missing map is a finding", files: { "app/lib/helper.ts": HELPER }, expect: "finding" },
  { name: "a map that does not parse is a finding", files: { [TEST_MAP_PATH]: "{ entries: [", "app/lib/helper.ts": HELPER }, expect: "finding" },
  {
    name: "a kind the map does not know is a finding",
    files: mapped([{ match: "app/lib/**", kind: "vibes" }], { "app/lib/helper.ts": HELPER }),
    expect: "finding",
  },
  {
    name: "a covered-by entry with no reason is a finding",
    files: mapped([{ match: "app/lib/**", kind: "covered-by", test: "e2e/home.spec.ts" }], { "app/lib/helper.ts": HELPER }),
    expect: "finding",
  },
  {
    name: "an entry that matches no file is a finding, so the map holds no dead rows",
    files: mapped([...UNIT, { match: "app/gone/**", kind: "unit" }], { "app/lib/helper.ts": HELPER, "app/lib/__tests__/helper.test.ts": REAL_TEST }),
    expect: "finding",
  },
  {
    name: "the first matching entry wins, so a narrow entry above a broad one decides",
    files: mapped([{ match: "app/lib/kinds.ts", kind: "declaration" }, ...UNIT], {
      "app/lib/kinds.ts": "export type A = { a: number };\n",
      "app/lib/helper.ts": HELPER,
      "app/lib/__tests__/helper.test.ts": REAL_TEST,
    }),
    expect: "clean",
  },
  { name: "tests and their helpers need no entry", files: mapped(UNIT, { "app/lib/helper.ts": HELPER, "app/lib/__tests__/helper.test.ts": REAL_TEST, "app/other/__tests__/support.ts": HELPER }), expect: "clean" },

  { name: "unit: a helper with a test that imports it and asserts is clean", files: unit(REAL_TEST), expect: "clean" },
  { name: "unit: a helper with no test is caught", files: mapped(UNIT, { "app/lib/helper.ts": HELPER }), expect: "finding" },
  { name: "unit: a test file that is close to empty is not a test", files: unit("// todo\n"), expect: "finding" },
  {
    name: "unit: a test whose assertions are all commented out is not a test",
    files: unit('import { helper } from "../helper";\n// it("adds", () => { expect(helper(1)).toBe(2); });\n// padding to clear the minimum length\n'),
    expect: "finding",
  },
  {
    name: "unit: a test that asserts and never imports the file is not a test",
    files: unit('import { expect, it } from "vitest";\nit("x", () => { expect(1).toBe(1); });\n'),
    expect: "finding",
  },
  {
    name: "unit: a test that imports another file with the same name does not count",
    files: unit(REAL_TEST.replace("../helper", "@/other/helper")),
    expect: "finding",
  },
  {
    name: "unit: a test that imports only the file's types does not count",
    files: unit('import { expect, it } from "vitest";\nimport type { helper } from "../helper";\nit("x", () => { expect(1 as unknown as ReturnType<typeof helper>).toBe(1); });\n'),
    expect: "finding",
  },
  {
    name: "unit: expect.soft counts as an assertion",
    files: unit('import { expect, it } from "vitest";\nimport { helper } from "../helper";\nit("adds", () => { expect.soft(helper(1)).toBe(2); });\n'),
    expect: "clean",
  },
  {
    name: "unit: an index file is imported through its folder",
    files: mapped([{ match: "app/trpc/**", kind: "unit" }], {
      "app/trpc/index.ts": HELPER,
      "app/trpc/__tests__/index.test.ts": REAL_TEST.replace("../helper", ".."),
    }),
    expect: "clean",
  },
  { name: "unit: a module that only exports types needs no test", files: mapped(UNIT, { "app/lib/kinds.ts": "export type A = { a: number };\n" }), expect: "clean" },
  { name: "unit: a module that only re-exports needs no test", files: mapped(UNIT, { "app/lib/barrel.ts": 'export { x } from "somewhere";\n' }), expect: "clean" },
  { name: "unit: a default export of a value needs a test", files: mapped(UNIT, { "app/lib/client.ts": "export default make();\n" }), expect: "finding" },
  { name: "unit: a script with no export still needs a test", files: mapped([{ match: "scripts/**", kind: "unit" }], { "scripts/job.ts": "run();\n" }), expect: "finding" },

  { name: "machine: a unit test and a paths spec that imports its model are clean", files: machine({ "e2e/door.paths.spec.ts": PATHS_SPEC }), expect: "clean" },
  { name: "machine: a unit test alone is not enough", files: machine({}), expect: "finding" },
  {
    name: "machine: a paths spec that imports neither the machine nor its model does not count",
    files: machine({ "e2e/door.paths.spec.ts": PATHS_SPEC.replace("@/components/door.model", "@/components/window.model") }),
    expect: "finding",
  },
  {
    name: "machine: a paths spec alone is not enough",
    files: mapped(MACHINE, { "app/components/door.machine.ts": MACHINE_FILE, "e2e/door.paths.spec.ts": PATHS_SPEC }),
    expect: "finding",
  },

  { name: "procedure: a LEVELS entry and a test that names the procedure are clean", files: procedure(LEVELS, { "app/trpc/routes/__tests__/notes.test.ts": PROCEDURE_TEST }), expect: "clean" },
  { name: "procedure: a procedure with no LEVELS entry is caught", files: procedure(LEVELS.replace("notes.list", "notes.other"), { "app/trpc/routes/__tests__/notes.test.ts": PROCEDURE_TEST }), expect: "finding" },
  { name: "procedure: a router with no procedure test is caught", files: procedure(LEVELS, {}), expect: "finding" },
  {
    name: "procedure: a test that names none of the file's procedures does not count",
    files: procedure(LEVELS, { "app/trpc/routes/__tests__/notes.test.ts": PROCEDURE_TEST.replace("notes.list()", "tags.all()") }),
    expect: "finding",
  },
  {
    name: "procedure: a procedure exported on its own and merged elsewhere is checked too",
    files: mapped(PROCEDURE, {
      "app/trpc/routes/health.ts": 'import { adminProcedure } from "..";\nexport const dbHealth = adminProcedure.query(() => 1);\n',
      [LEVELS_FILE]: LEVELS,
      "app/trpc/routes/__tests__/health.test.ts": PROCEDURE_TEST.replace("notes.list()", "admin.dbHealth()"),
    }),
    expect: "finding",
  },

  { name: "route: a spec with both tags that visits the path is clean", files: route({ "e2e/users.spec.ts": smokeSpec('"/admin/users"', ["@golden", "@error"]) }), expect: "clean" },
  { name: "route: a visit with a hash or a query still counts", files: route({ "e2e/users.spec.ts": smokeSpec('"/admin/users?tab=1#top"', ["@golden", "@error"]) }), expect: "clean" },
  { name: "route: a spec with only a golden test is not enough", files: route({ "e2e/users.spec.ts": smokeSpec('"/admin/users"', ["@golden"]) }), expect: "finding" },
  { name: "route: a tagged spec that visits another page does not count", files: route({ "e2e/users.spec.ts": smokeSpec('"/admin"', ["@golden", "@error"]) }), expect: "finding" },
  { name: "route: a path that only extends this one does not count", files: route({ "e2e/users.spec.ts": smokeSpec('"/admin/users/7"', ["@golden", "@error"]) }), expect: "finding" },
  { name: "route: a page with no spec is caught", files: route({}), expect: "finding" },
  { name: "route: a page the route table does not list is caught", files: route({ "e2e/users.spec.ts": smokeSpec('"/admin/users"', ["@golden", "@error"]) }, "export default [];\n"), expect: "finding" },
  {
    name: "route: a layout is proven by a visit to the path it wraps",
    files: route({
      "app/routes/admin/_layout.tsx": PAGE,
      "e2e/admin.spec.ts": smokeSpec('"/admin"', ["@golden", "@error"]),
      "e2e/users.spec.ts": smokeSpec('"/admin/users"', ["@golden", "@error"]),
    }),
    expect: "clean",
  },

  { name: "component: a file in the sandbox that renders it is clean", files: component("component", { "app/routes/sandbox/button.tsx": 'import { Button } from "@/components/button";\nexport type Shown = typeof Button;\n' }), expect: "clean" },
  { name: "component: a component with no sandbox entry is caught", files: component("component", {}), expect: "finding" },
  { name: "primitive: a file in the sandbox that renders it is clean", files: component("primitive", { "app/routes/sandbox/button.tsx": 'import { Button } from "@/components/button";\nexport type Shown = typeof Button;\n' }), expect: "clean" },
  { name: "primitive: a primitive with no sandbox entry is caught", files: component("primitive", {}), expect: "finding" },

  { name: "declaration: a file of types is clean", files: mapped([{ match: "app/**/*.d.ts", kind: "declaration" }, { match: "app/lib/kinds.ts", kind: "declaration" }], { "app/lib/kinds.ts": "export interface A { a: number }\n", "app/i18n/i18n.d.ts": "declare module 'x' { const a: number; }\n" }), expect: "clean" },
  { name: "declaration: a file that holds code is caught", files: mapped([{ match: "app/lib/kinds.ts", kind: "declaration" }], { "app/lib/kinds.ts": "export const a = 1;\n" }), expect: "finding" },

  { name: "covered-by: a named test that exists and asserts is clean", files: coveredBy({ "e2e/home.spec.ts": smokeSpec('"/"', ["@golden"]) }), expect: "clean" },
  { name: "covered-by: a named test that does not exist is caught", files: coveredBy({}), expect: "finding" },
  { name: "covered-by: a named test that asserts nothing is caught", files: coveredBy({ "e2e/home.spec.ts": 'import { test } from "@playwright/test";\ntest("x", async () => {});\n' }), expect: "finding" },
];
