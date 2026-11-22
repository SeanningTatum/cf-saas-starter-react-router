import type { AnyProcedure, AnyRouter } from "@trpc/server";
import { Schema, type SchemaAST } from "effect";

/**
 * Reads the input schemas off a tRPC router so a test can walk them. Shared by
 * `router.test.ts` (no id field where a procedure claims to take none) and
 * `input-bounds.test.ts` (every string, array and record is capped).
 */

/**
 * The input schema ASTs of every procedure, keyed by dotted path. A parser that
 * is not an Effect Schema comes back as `null`: the walks cannot see into it,
 * so callers must treat it as a failure, never as "nothing to check".
 */
export const inputAstsOf = (
  router: AnyRouter
): Record<string, Array<SchemaAST.AST | null>> => {
  const procedures: Record<string, AnyProcedure> = router._def.procedures;
  return Object.fromEntries(
    Object.entries(procedures).map(([path, procedure]) => [
      path,
      procedure._def.inputs.map((parser) => (Schema.isSchema(parser) ? parser.ast : null)),
    ])
  );
};

/**
 * One level down the AST. `segment` is the property name (or `[]` / `[i]` /
 * `{key}` / `{value}`) the hop adds to a readable path, or `null` for a hop
 * that still describes the same value (refinement, union member, either side
 * of a transformation, a suspended schema).
 */
export const childrenOf = (
  ast: SchemaAST.AST
): Array<{ segment: string | null; ast: SchemaAST.AST }> => {
  switch (ast._tag) {
    case "Refinement":
      return [{ segment: null, ast: ast.from }];
    case "Transformation":
      // A struct with defaults is a transformation; both sides carry fields.
      return [
        { segment: null, ast: ast.from },
        { segment: null, ast: ast.to },
      ];
    case "Suspend":
      return [{ segment: null, ast: ast.f() }];
    case "Union":
      return ast.types.map((member) => ({ segment: null, ast: member }));
    case "TypeLiteral":
      return [
        ...ast.propertySignatures.map((p) => ({ segment: String(p.name), ast: p.type })),
        ...ast.indexSignatures.flatMap((s) => [
          { segment: "{key}", ast: s.parameter },
          { segment: "{value}", ast: s.type },
        ]),
      ];
    case "TupleType":
      return [
        ...ast.elements.map((e, i) => ({ segment: `[${i}]`, ast: e.type })),
        ...ast.rest.map((r) => ({ segment: "[]", ast: r.type })),
      ];
    default:
      return [];
  }
};

/** `userIds` + `[]` is `userIds[]`; `data` + `name` is `data.name`. */
export const joinPath = (path: string, segment: string | null): string =>
  segment === null
    ? path
    : path === "" || segment.startsWith("[") || segment.startsWith("{")
      ? `${path}${segment}`
      : `${path}.${segment}`;
