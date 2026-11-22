import { TRPCError, type AnyRouter } from "@trpc/server";
import { Option, Schema, SchemaAST } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_BULK_USER_IDS } from "@/lib/schemas/user";
import { createTRPCRouter, publicProcedure } from "@/trpc";
import { appRouter } from "@/trpc/router";
import { childrenOf, inputAstsOf, joinPath } from "./procedure-inputs";
import { startRealApp, type Account, type AppCaller, type RealApp } from "./real-d1";

/**
 * Every tRPC input has a size limit, and the limits hold on real D1 (#70).
 *
 * The hole: an input string with no maxLength, or an array with no maxItems,
 * lets one request push an unbounded payload into a query. `userIds` had no
 * maximum at all, and D1 refuses a statement that binds more than 100
 * variables, so a bulk action over ~97 users failed outright. `search` went
 * into LIKE unescaped, so `%` or `_` matched every user.
 *
 * The first half walks every procedure's input schema; the second calls the
 * bulk and search procedures on the real-D1 harness (`./real-d1.ts`), because
 * only real SQLite shows a variable-limit overflow or a LIKE wildcard.
 */

// `import.meta.env.DEV` is always true under vitest, which makes
// `timingMiddleware` sleep 100-499ms of real time per call.
vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const MAX_ARRAY = 100;

type Caps = { maxLength?: number; maxItems?: number; maxProperties?: number };

const capOf = (ast: SchemaAST.AST, key: keyof Caps): number | undefined => {
  const annotation = Option.getOrUndefined(SchemaAST.getJSONSchemaAnnotation(ast));
  if (annotation === undefined || !(key in annotation)) return undefined;
  const value: unknown = Reflect.get(annotation, key);
  return typeof value === "number" ? value : undefined;
};

/** A refinement chain is read outside-in; the tightest cap along it wins. */
const tighten = (caps: Caps, ast: SchemaAST.AST): Caps => {
  const next: Caps = { ...caps };
  for (const key of ["maxLength", "maxItems", "maxProperties"] as const) {
    const cap = capOf(ast, key);
    if (cap !== undefined) next[key] = Math.min(cap, next[key] ?? cap);
  }
  return next;
};

/** Every uncapped string, array and record in the given input schemas. */
const boundsViolations = (asts: ReadonlyArray<SchemaAST.AST | null>): string[] => {
  const found = new Set<string>();
  const walk = (ast: SchemaAST.AST, path: string, caps: Caps, seen: ReadonlySet<SchemaAST.AST>) => {
    if (seen.has(ast)) return;
    const where = path === "" ? "input" : path;
    const below = new Set(seen).add(ast);
    switch (ast._tag) {
      case "Refinement":
        // Caps sit on the refinements wrapping a node, so carry them down.
        return walk(ast.from, path, tighten(caps, ast), below);
      case "StringKeyword":
      case "TemplateLiteral":
        if (caps.maxLength === undefined) found.add(`${where}: string has no maxLength`);
        return;
      case "UnknownKeyword":
      case "AnyKeyword":
      case "ObjectKeyword":
        found.add(`${where}: ${ast._tag} accepts a value of any size`);
        return;
      case "TupleType":
        if (ast.rest.length > 0) {
          if (caps.maxItems === undefined) found.add(`${where}: array has no maxItems`);
          else if (caps.maxItems > MAX_ARRAY)
            found.add(`${where}: array allows ${caps.maxItems} items, over ${MAX_ARRAY}`);
        }
        break;
      case "TypeLiteral":
        if (ast.indexSignatures.length > 0 && caps.maxProperties === undefined)
          found.add(`${where}: record has no maxProperties`);
        break;
    }
    for (const child of childrenOf(ast)) {
      walk(child.ast, joinPath(path, child.segment), {}, below);
    }
  };
  for (const ast of asts) {
    if (ast === null) found.add("input: not an Effect Schema, so it cannot be checked");
    else walk(ast, "", {}, new Set());
  }
  return [...found].sort();
};

const routerViolations = (router: AnyRouter): string[] =>
  Object.entries(inputAstsOf(router))
    .flatMap(([path, asts]) => boundsViolations(asts).map((violation) => `${path}: ${violation}`))
    .sort();

describe("every procedure input is bounded", () => {
  it("has a maxLength on every string, maxItems of 100 or less on every array, maxProperties on every record", () => {
    // Catches: a new or edited input field with no size cap, anywhere in the
    // router, including inside nested structs, optionals and records.
    expect(routerViolations(appRouter)).toEqual([]);
  });

  it("the walker reports each kind of uncapped input, and nothing for capped ones", () => {
    // Catches: a walker that passes the router by seeing nothing (a missed
    // AST tag, caps not carried down a refinement chain, inputs not read).
    const capped = Schema.String.pipe(Schema.maxLength(9));
    const fixture = createTRPCRouter({
      uncapped: publicProcedure
        .input(
          Schema.standardSchemaV1(
            Schema.Struct({
              text: Schema.String,
              list: Schema.Array(capped),
              tooLong: Schema.Array(capped).pipe(Schema.maxItems(MAX_ARRAY + 1)),
              looseItems: Schema.Array(Schema.String).pipe(Schema.maxItems(5)),
              record: Schema.Record({ key: capped, value: capped }),
              looseKeys: Schema.Record({ key: Schema.String, value: capped }).pipe(
                Schema.filter(() => true, { jsonSchema: { maxProperties: 5 } })
              ),
              nested: Schema.optional(Schema.Struct({ deep: Schema.String })),
              anything: Schema.Unknown,
            })
          )
        )
        .query(() => null),
      capped: publicProcedure
        .input(
          Schema.standardSchemaV1(
            Schema.Struct({
              // minLength wraps maxLength: the cap is one refinement down.
              text: Schema.String.pipe(Schema.maxLength(9), Schema.minLength(1)),
              list: Schema.Array(capped).pipe(Schema.minItems(1), Schema.maxItems(MAX_ARRAY)),
              record: Schema.Record({ key: capped, value: capped }).pipe(
                Schema.filter(() => true, { jsonSchema: { maxProperties: 5 } })
              ),
              withDefault: Schema.optionalWith(capped, { default: () => "x" }),
              either: Schema.Union(capped, Schema.Number),
              role: Schema.optional(Schema.Literal("user", "admin")),
              count: Schema.Number,
              flag: Schema.Boolean,
              at: Schema.DateFromSelf,
            })
          )
        )
        .query(() => null),
      notEffect: publicProcedure.input((value: unknown) => value).query(() => null),
    });

    expect(routerViolations(fixture)).toEqual([
      "notEffect: input: not an Effect Schema, so it cannot be checked",
      "uncapped: anything: UnknownKeyword accepts a value of any size",
      "uncapped: list: array has no maxItems",
      "uncapped: looseItems[]: string has no maxLength",
      "uncapped: looseKeys{key}: string has no maxLength",
      "uncapped: nested.deep: string has no maxLength",
      "uncapped: record: record has no maxProperties",
      "uncapped: text: string has no maxLength",
      `uncapped: tooLong: array allows ${MAX_ARRAY + 1} items, over ${MAX_ARRAY}`,
    ]);
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
          .bind(r.id, r.name, r.email)
      )
    );
    return rows.map((r) => r.id);
  };

  const plainUsers = (prefix: string, n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${i}`,
      name: `${prefix} ${i}`,
      email: `${prefix}-${i}@bounds.test`,
    }));

  const countWhere = async (prefix: string, where: string) =>
    (
      await app.db
        .prepare(`SELECT count(*) AS n FROM user WHERE id LIKE ? AND ${where}`)
        .bind(`${prefix}-%`)
        .first<{ n: number }>()
    )?.n;

  type Bulk = {
    path: string;
    run: (caller: AppCaller, userIds: string[]) => Promise<unknown>;
    /** Rows in the batch matching this after the call... */
    landed: string;
    /** ...count this many when the action worked on all of them. */
    landedCount: number;
  };

  const BULK: Bulk[] = [
    {
      path: "admin.bulkBanUsers",
      // A reason and an expiry: the UPDATE binds every SET column it can.
      run: (caller, userIds) =>
        caller.admin.bulkBanUsers({
          userIds,
          reason: "spam",
          expiresAt: new Date("2999-01-01T00:00:00Z"),
        }),
      landed: "banned = 1",
      landedCount: MAX_BULK_USER_IDS,
    },
    {
      path: "admin.bulkUpdateUserRoles",
      run: (caller, userIds) => caller.admin.bulkUpdateUserRoles({ userIds, role: "admin" }),
      landed: "role = 'admin'",
      landedCount: MAX_BULK_USER_IDS,
    },
    {
      path: "admin.bulkDeleteUsers",
      run: (caller, userIds) => caller.admin.bulkDeleteUsers({ userIds }),
      landed: "1 = 1",
      landedCount: 0,
    },
  ];

  it.each(BULK)("$path works on MAX_BULK_USER_IDS users in one call", async (bulk) => {
    // Catches: a cap raised past what D1's 100-variable limit allows, or a
    // new SET column pushing the bulk statement over it.
    const prefix = `cap-${bulk.path}`;
    const userIds = await seed(plainUsers(prefix, MAX_BULK_USER_IDS));

    const result = await bulk.run(await asAdmin(), userIds);

    expect(result).toEqual({
      success: true,
      affectedCount: MAX_BULK_USER_IDS,
      skippedCount: 0,
    });
    expect(await countWhere(prefix, bulk.landed)).toBe(bulk.landedCount);
  });

  it.each(BULK)("$path refuses one id over the cap at the input, and touches no row", async (bulk) => {
    // Catches: maxItems dropped or raised past MAX_BULK_USER_IDS, or the cap
    // checked after the query instead of before it.
    const prefix = `over-${bulk.path}`;
    const userIds = await seed(plainUsers(prefix, MAX_BULK_USER_IDS + 1));

    const outcome = await bulk.run(await asAdmin(), userIds).then(
      () => "ok",
      (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`)
    );

    expect(outcome).toBe("BAD_REQUEST");
    expect(
      await countWhere(prefix, "banned = 0 AND role = 'user'"),
      "every row as it was seeded"
    ).toBe(MAX_BULK_USER_IDS + 1);
  });

  describe("admin.getUsers search matches LIKE wildcards literally", () => {
    beforeAll(async () => {
      // Each literal name has a decoy that matches only if its character is
      // read as a wildcard.
      await seed([
        { id: "like-percent", name: "100% real", email: "like-percent@bounds.test" },
        { id: "like-percent-decoy", name: "100x real", email: "like-percent-decoy@bounds.test" },
        { id: "like-under", name: "under_score", email: "like-under@bounds.test" },
        { id: "like-under-decoy", name: "underxscore", email: "like-under-decoy@bounds.test" },
        { id: "like-slash", name: "back\\slash", email: "like-slash@bounds.test" },
        { id: "like-slash-decoy", name: "backslash", email: "like-slash-decoy@bounds.test" },
        { id: "like-name", name: "has needle inside", email: "like-name@bounds.test" },
        { id: "like-mail", name: "Mail Match", email: "needle-by-mail@bounds.test" },
      ]);
    });

    const namesFor = async (search: string) =>
      (await (await asAdmin()).admin.getUsers({ search, limit: 100 })).users
        .map((u) => u.name)
        .sort();

    it.each([
      // Catches: `%` passed through as "any run of characters".
      { search: "%", names: ["100% real"] },
      // Catches: `_` passed through as "any one character".
      { search: "_", names: ["under_score"] },
      // Catches: escaping `%` and `_` with `\` but not `\` itself.
      { search: "\\", names: ["back\\slash"] },
      // Catches: escaping that drops the wildcards around the term (exact
      // match only), or stops searching the email.
      { search: "needle", names: ["Mail Match", "has needle inside"] },
    ])("search $search returns $names", async ({ search, names }) => {
      expect(await namesFor(search)).toEqual(names);
    });
  });
});
