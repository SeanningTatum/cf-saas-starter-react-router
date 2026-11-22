import ts from "typescript";
import { isSourcePath, isTestPath, lineOf, walkNodes } from "../source";
import { calleeName, callsAny, contains, localsThatReach } from "../span-ast";
import type { FileHit, FileRule } from "../types";

const PROCEDURE_FILES = /^app\/trpc\/routes\/.+\.ts$/;
const PROCEDURE_KINDS = new Set(["query", "mutation", "subscription"]);
const PROCEDURE_BUILDER = /Procedure$/;
const RUN_PROCEDURE = "runProcedure";
const SPAN_OPTION = "span";
const SPAN_PREFIX = "trpc.";

const inRoutes = (code: string): Record<string, string> => ({ "app/trpc/routes/x.ts": code });
const procedure = (body: string): Record<string, string> =>
  inRoutes(`export const r = { p: publicProcedure.query(({ ctx }) => ${body}) };`);

const isProcedureBuilder = (receiver: ts.Expression): boolean =>
  contains(receiver, (node) => ts.isIdentifier(node) && PROCEDURE_BUILDER.test(node.text));

function spanOptionProblem(call: ts.CallExpression): string | undefined {
  const options = call.arguments[2];
  if (!options) return "`runProcedure` call with no `{ span }` option";
  if (!ts.isObjectLiteralExpression(options)) return "`runProcedure` options are not an object literal, so `span` cannot be read";
  const span = options.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
      property.name.text === SPAN_OPTION
  );
  if (!span) return "`runProcedure` options with no `span`";
  const literal = ts.isPropertyAssignment(span) && ts.isStringLiteralLike(span.initializer) ? span.initializer.text : undefined;
  return literal !== undefined && !literal.startsWith(SPAN_PREFIX)
    ? `span "${literal}" does not start with "${SPAN_PREFIX}"`
    : undefined;
}

export const rule: FileRule = {
  id: "procedure-span",
  scope: "file",
  matches:
"A tRPC `.query`, `.mutation` or `.subscription` on a `…Procedure` builder whose handler never reaches `runProcedure` or is passed by reference, " +
    'a `runProcedure` call whose third argument is not an object literal with `span`, or a literal span name that does not start with "trpc.". ' +
    "A builder kept in a variable with another name is not seen.",
  covers: "`app/trpc/routes/`, subfolders included, except tests.",
  fix:
    'write the handler inline and run it through `runProcedure(ctx.runtime, effect, { span: "trpc.<router>.<procedure>" })`, ' +
    "which adds the server span every log line and query of the procedure hangs from",
  example: "app/trpc/routes/health.ts",
  applies: (path) => PROCEDURE_FILES.test(path) && isSourcePath(path) && !isTestPath(path),
  check({ ast }) {
    const hits: FileHit[] = [];
    const runners = localsThatReach(ast, RUN_PROCEDURE);
    walkNodes(ast, (node) => {
      if (!ts.isCallExpression(node)) return;
      const name = calleeName(node);
      if (name === RUN_PROCEDURE) {
        const problem = spanOptionProblem(node);
        if (problem) hits.push({ line: lineOf(ast, node), message: problem });
        return;
      }
      const handler = node.arguments[0];
      const isProcedure =
        ts.isPropertyAccessExpression(node.expression) &&
        PROCEDURE_KINDS.has(name ?? "") &&
        handler !== undefined &&
        isProcedureBuilder(node.expression.expression);
      if (!isProcedure) return;
      if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) {
        hits.push({
          line: lineOf(ast, node),
          message: `procedure \`.${name}(...)\` takes its handler by reference, so its span cannot be checked`,
        });
        return;
      }
      if (!callsAny(handler, runners)) {
        hits.push({
          line: lineOf(ast, node),
          message: `procedure \`.${name}(...)\` never reaches \`runProcedure\`, so it has no span`,
        });
      }
    });
    return hits;
  },
  cases: [
    { name: "a procedure that never reaches runProcedure is caught", files: procedure("1"), expect: "finding" },
    { name: "runProcedure with no options is caught", files: procedure("runProcedure(ctx.runtime, e)"), expect: "finding" },
    { name: "options with no span are caught", files: procedure("runProcedure(ctx.runtime, e, {})"), expect: "finding" },
    {
      name: "options passed as a variable are caught, since span cannot be read",
      files: procedure("runProcedure(ctx.runtime, e, options)"),
      expect: "finding",
    },
    {
      name: "a span that does not start with trpc. is caught",
      files: procedure('runProcedure(ctx.runtime, e, { span: "admin.p" })'),
      expect: "finding",
    },
    {
      name: "a handler passed by reference is caught",
      files: inRoutes("const handler = () => 1;\nexport const r = { p: adminProcedure.query(handler) };"),
      expect: "finding",
    },
    {
      name: "a mutation in a subfolder is covered",
      files: { "app/trpc/routes/billing/invoices.ts": "export const r = { p: adminProcedure.mutation(() => 1) };" },
      expect: "finding",
    },
    {
      name: "a procedure with a trpc.* span is clean",
      files: procedure('runProcedure(ctx.runtime, e, { span: "trpc.x.p" })'),
      expect: "clean",
    },
    {
      name: "a quoted span key is read",
      files: procedure('runProcedure(ctx.runtime, e, { "span": "trpc.x.p" })'),
      expect: "clean",
    },
    {
      name: "a procedure that runs through a local helper that calls runProcedure is clean",
      files: inRoutes(
        "const run = (ctx: any, span: string) => runProcedure(ctx.runtime, e, { span });\n" +
          'export const r = { p: publicProcedure.input(s).mutation(({ ctx }) => run(ctx, "trpc.x.p")) };'
      ),
      expect: "clean",
    },
    {
      name: "a builder renamed to a name that does not end in Procedure is not seen (a known gap)",
      files: inRoutes("const base = adminProcedure.use(mw);\nexport const r = { p: base.query(() => 1) };"),
      expect: "clean",
    },
    {
      name: "a db.query() call is not a procedure",
      files: inRoutes("export const rows = db.query(sql);"),
      expect: "clean",
    },
    {
      name: "a file outside the routes folder is not checked",
      files: { "app/trpc/index.ts": "export const r = { p: publicProcedure.query(() => 1) };" },
      expect: "clean",
    },
  ],
};
