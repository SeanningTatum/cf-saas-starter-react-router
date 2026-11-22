import type { AnyProcedure, AnyRouter } from "@trpc/server";
import { Option, Schema, SchemaAST } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_BULK_USER_IDS } from "@/lib/schemas/user";
import { createTRPCRouter, publicProcedure } from "@/trpc";
import { appRouter } from "@/trpc/router";
import { startRealApp, type Account, type AppCaller, type RealApp } from "./real-d1";

/**
 * Every tRPC input has a size limit, and the limits hold on real D1 (#70).
 *
 * The hole: a string with no maxLength, or an array with no maxItems, lets one
 * request push an unbounded payload into a query. `userIds` had no maximum, and
 * D1 refuses a statement that binds more than 100 variables, so a large bulk
 * action failed outright. `search` matched `%` and `_` as wildcards.
 *
 * The first half walks every procedure's input schema; the second calls the
 * bulk and search procedures on real D1 (`./real-d1.ts`), because only real
 * SQLite shows a variable-limit overflow or how a search term is matched.
 */

// `import.meta.env.DEV` is always true under vitest, which makes
// `timingMiddleware` sleep 100-499ms of real time per call.
vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const MAX_ARRAY = 100;

// Declared types known to have a fixed size. Matched on the decoder, which
// survives `.annotations(...)` and cannot be copied by naming a schema
// "DateFromSelf". superjson lets a client send a Map or a Set, so any other
// declaration (ReadonlySetFromSelf, Uint8ArrayFromSelf, Schema.declare) fails.
const FIXED_SIZE = [Schema.DateFromSelf.ast];

/** The caps a refinement chain puts on the node below it; the outermost wins. */
type Caps = { maxLength?: unknown; maxItems?: unknown; maxProperties?: unknown };

const violationsIn = (
  ast: SchemaAST.AST,
  at: string,
  caps: Caps,
  seen: ReadonlySet<SchemaAST.AST>,
): string[] => {
  if (seen.has(ast)) return [];
  const down = (child: SchemaAST.AST, path = at, childCaps: Caps = {}) =>
    violationsIn(child, path, childCaps, new Set(seen).add(ast));
  switch (ast._tag) {
    case "Refinement":
      return down(ast.from, at, {
        ...Option.getOrElse(SchemaAST.getJSONSchemaAnnotation(ast), () => ({})),
        ...caps,
      });
    case "StringKeyword":
    case "TemplateLiteral":
      return typeof caps.maxLength === "number" ? [] : [`${at}: string has no maxLength`];
    case "TupleType": {
      const items = caps.maxItems;
      const own =
        ast.rest.length === 0
          ? []
          : typeof items !== "number"
            ? [`${at}: array has no maxItems`]
            : items > MAX_ARRAY
              ? [`${at}: array allows ${items} items, over ${MAX_ARRAY}`]
              : [];
      return [
        ...own,
        ...ast.elements.flatMap((e, i) => down(e.type, `${at}[${i}]`)),
        ...ast.rest.flatMap((r) => down(r.type, `${at}[]`)),
      ];
    }
    case "TypeLiteral":
      return [
        ...(ast.indexSignatures.length > 0 && typeof caps.maxProperties !== "number"
          ? [`${at}: record has no maxProperties`]
          : []),
        ...ast.propertySignatures.flatMap((p) => down(p.type, `${at}.${String(p.name)}`)),
        ...ast.indexSignatures.flatMap((s) => [
          ...down(s.parameter, `${at}{key}`),
          ...down(s.type, `${at}{value}`),
        ]),
      ];
    // A struct with defaults is a transformation; both sides carry fields.
    case "Transformation":
      return [...down(ast.from), ...down(ast.to)];
    case "Union":
      return ast.types.flatMap((member) => down(member));
    case "Suspend":
      return down(ast.f());
    case "Declaration":
      return FIXED_SIZE.some(
        (d) => SchemaAST.isDeclaration(d) && d.decodeUnknown === ast.decodeUnknown,
      )
        ? []
        : [`${at}: declared type not known to have a fixed size`];
    case "UnknownKeyword":
    case "AnyKeyword":
    case "ObjectKeyword":
      return [`${at}: ${ast._tag} accepts a value of any size`];
    default:
      return [];
  }
};

/** A parser that is not an Effect Schema cannot be walked, so it fails. */
const parserViolations = (parser: unknown): string[] => [
  ...new Set(
    Schema.isSchema(parser)
      ? violationsIn(parser.ast, "input", {}, new Set())
      : ["input: not an Effect Schema, so it cannot be checked"],
  ),
];

const routerViolations = (router: AnyRouter): string[] => {
  const procedures: Record<string, AnyProcedure> = router._def.procedures;
  return Object.entries(procedures)
    .flatMap(([path, procedure]) =>
      procedure._def.inputs.flatMap(parserViolations).map((v) => `${path}: ${v}`),
    )
    .sort();
};

describe("every procedure input is bounded", () => {
  it("has a maxLength on every string, maxItems of 100 or less on every array, maxProperties on every record", () => {
    expect(routerViolations(appRouter)).toEqual([]);
  });

  it("reads the inputs off the router, and fails one it cannot see into", () => {
    // Catches: a walker that passes the router by reading no inputs at all.
    const router = createTRPCRouter({
      notEffect: publicProcedure.input((value: unknown) => value).query(() => null),
    });
    expect(routerViolations(router)).toEqual([
      "notEffect: input: not an Effect Schema, so it cannot be checked",
    ]);
  });

  const capped = Schema.String.pipe(Schema.maxLength(9));
  const boundedRecord = Schema.Record({ key: capped, value: capped }).pipe(
    Schema.filter(() => true, { jsonSchema: { maxProperties: 5 } }),
  );

  it.each<[string, unknown, string[]]>([
    // The default makes the struct a transformation: the walker must go
    // through it and the optional to reach `a.b`.
    [
      "uncapped string",
      Schema.Struct({
        a: Schema.optional(Schema.Struct({ b: Schema.String })),
        c: Schema.optionalWith(capped, { default: () => "x" }),
      }),
      ["input.a.b: string has no maxLength"],
    ],
    // minLength wraps maxLength: the cap is one refinement down.
    ["capped string", Schema.String.pipe(Schema.maxLength(9), Schema.minLength(1)), []],
    ["uncapped array", Schema.Array(capped), ["input: array has no maxItems"]],
    [
      "array over 100",
      Schema.Array(capped).pipe(Schema.maxItems(MAX_ARRAY + 1)),
      [`input: array allows ${MAX_ARRAY + 1} items, over ${MAX_ARRAY}`],
    ],
    ["capped array", Schema.Array(capped).pipe(Schema.minItems(1), Schema.maxItems(MAX_ARRAY)), []],
    [
      "unbounded record",
      Schema.Record({ key: capped, value: capped }),
      ["input: record has no maxProperties"],
    ],
    ["bounded record", boundedRecord, []],
    ["unknown", Schema.Unknown, ["input: UnknownKeyword accepts a value of any size"]],
    [
      "un-listed declaration",
      Schema.ReadonlySetFromSelf(capped),
      ["input: declared type not known to have a fixed size"],
    ],
    // Annotated, as a schema in the app might be: still the same decoder.
    ["DateFromSelf", Schema.DateFromSelf.annotations({ description: "when" }), []],
  ])("%s", (_, schema, expected) => {
    expect(parserViolations(schema)).toEqual(expected);
  });
});

describe("bulk procedures and search on real D1", { timeout: 60_000 }, () => {
  let app: RealApp;
  let admin: Account;

  beforeAll(async () => {
    app = await startRealApp();
    admin = await app.signUpAdmin("admin@bounds.test");
  }, 60_000);

  afterAll(async () => {
    await app?.dispose();
  });

  const asAdmin = () => app.callerFor(admin.headers);

  type Row = { id: string; name: string; email: string };

  /** Plain users straight into D1: signing up 50 users would hash 50 passwords. */
  const seed = async (rows: ReadonlyArray<Row>): Promise<string[]> => {
    await app.db.batch(
      rows.map((r) =>
        app.db
          .prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)")
          .bind(r.id, r.name, r.email),
      ),
    );
    return rows.map((r) => r.id);
  };

  const seedUsers = (prefix: string, n: number) =>
    seed(
      Array.from({ length: n }, (_, i) => ({
        id: `${prefix}-${i}`,
        name: `${prefix} ${i}`,
        email: `${prefix}-${i}@bounds.test`,
      })),
    );

  /** Rows with this prefix still as seeded: present, not banned, role user. */
  const untouched = async (prefix: string) =>
    (
      await app.db
        .prepare("SELECT count(*) AS n FROM user WHERE id LIKE ? AND banned = 0 AND role = 'user'")
        .bind(`${prefix}-%`)
        .first<{ n: number }>()
    )?.n;

  const BULK: Record<string, (caller: AppCaller, userIds: string[]) => Promise<unknown>> = {
    // A reason and an expiry: the UPDATE binds every SET column it can.
    "admin.bulkBanUsers": (caller, userIds) =>
      caller.admin.bulkBanUsers({
        userIds,
        reason: "spam",
        expiresAt: new Date("2999-01-01T00:00:00Z"),
      }),
    "admin.bulkUpdateUserRoles": (caller, userIds) =>
      caller.admin.bulkUpdateUserRoles({ userIds, role: "admin" }),
    "admin.bulkDeleteUsers": (caller, userIds) => caller.admin.bulkDeleteUsers({ userIds }),
  };

  it.each(Object.entries(BULK))(
    "%s works on MAX_BULK_USER_IDS users in one call",
    async (path, run) => {
      // Catches: a cap raised past what D1's 100-variable limit allows, or a
      // new SET column pushing the bulk statement over it.
      const prefix = `cap-${path}`;
      const userIds = await seedUsers(prefix, MAX_BULK_USER_IDS);

      expect(await run(await asAdmin(), userIds)).toEqual({
        success: true,
        affectedCount: MAX_BULK_USER_IDS,
        skippedCount: 0,
      });
      expect(await untouched(prefix), "rows the action missed").toBe(0);
    },
  );

  it("refuses one id over the cap at the input, and touches no row", async () => {
    // Catches: maxItems dropped or raised past MAX_BULK_USER_IDS, or checked
    // after the query instead of before it.
    const userIds = await seedUsers("over", MAX_BULK_USER_IDS + 1);

    await expect((await asAdmin()).admin.bulkDeleteUsers({ userIds })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await untouched("over")).toBe(MAX_BULK_USER_IDS + 1);
  });

  describe("admin.getUsers search", () => {
    const LONG_TERM = "long".repeat(25); // 100 characters, the schema's cap

    beforeAll(async () => {
      // Each literal name has a decoy that matches only if its character is
      // read as a wildcard.
      await seed([
        { id: "s-percent", name: "100% real", email: "s-percent@bounds.test" },
        { id: "s-percent-decoy", name: "100x real", email: "s-percent-decoy@bounds.test" },
        { id: "s-under", name: "under_score", email: "s-under@bounds.test" },
        { id: "s-under-decoy", name: "underxscore", email: "s-under-decoy@bounds.test" },
        { id: "s-slash", name: "back\\slash", email: "s-slash@bounds.test" },
        { id: "s-slash-decoy", name: "backslash", email: "s-slash-decoy@bounds.test" },
        { id: "s-name", name: "Has NEEDLE Inside", email: "s-name@bounds.test" },
        { id: "s-mail", name: "Mail Match", email: "needle-by-mail@bounds.test" },
        { id: "s-long", name: `a ${LONG_TERM} b`, email: "s-long@bounds.test" },
      ]);
    });

    const namesFor = async (search: string) =>
      (await (await asAdmin()).admin.getUsers({ search, limit: 100 })).users
        .map((u) => u.name)
        .sort();

    it.each([
      { search: "%", names: ["100% real"] },
      { search: "_", names: ["under_score"] },
      { search: "\\", names: ["back\\slash"] },
      // Catches: an exact or case-sensitive match on name, or email no longer searched.
      { search: "needle", names: ["Has NEEDLE Inside", "Mail Match"] },
    ])("search $search matches only $names", async ({ search, names }) => {
      expect(await namesFor(search)).toEqual(names);
    });

    it("a search at the schema's 100-character cap works", async () => {
      // Catches: going back to LIKE, which D1 refuses for any pattern over 50 bytes.
      expect(await namesFor(LONG_TERM)).toEqual([`a ${LONG_TERM} b`]);
    });
  });
});
