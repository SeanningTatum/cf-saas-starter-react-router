#!/usr/bin/env bun
/**
 * Five non-negotiables — STRUCTURAL enforcement, not a grep sweep.
 *
 * Run: bun run scripts/check-non-negotiables.ts   (exit 1 on any violation)
 *      bun run scripts/check-non-negotiables.ts --selftest   (prove it can fail)
 *
 * Why this replaced the CI grep sweep (`.github/workflows/ci.yml`, the
 * `effect-ts-grep` job): the sweep matched added diff lines with
 * `grep -E '\bthrow new\b'`, so every one of these walked straight through it —
 *
 *   throw err;                      // not `throw new`
 *   try { ... } catch {}            // never checked at all
 *   import { z } from 'zod'         // the pattern was double-quote only
 *   Effect.promise(() => mayReject()) // never checked
 *
 * — and it only ever looked at the diff, so a violation that moved between files
 * became invisible. Worse, non-negotiable #4 ("unit test for every helper and
 * repository") had NO gate anywhere, and the repo was already violating it.
 *
 * This walks the TypeScript AST via the compiler API already present as a dev
 * dependency, so `throw` is `throw` regardless of how it is spelled, and the
 * checks apply to the whole tree rather than to one diff.
 *
 * The five (see AGENTS.md / .brain/codebase/effect-ts.md):
 *   1. Effect TS is the default — no `throw`, no `try/catch` outside Effect.tryPromise
 *   2. Effect Schema for all validation — no Zod
 *   3. Tagged errors in app/models/errors/, mapped in app/lib/effect-trpc.ts
 *   4. Unit test for every helper and repository
 *   5. Cloudflare Workers, not Node — no process.env
 */
import ts from "typescript";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";

const ROOT = process.cwd();

type Violation = { rule: string; file: string; line: number; detail: string };
const violations: Violation[] = [];

function add(rule: string, file: string, node: ts.Node, sf: ts.SourceFile, detail: string) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  violations.push({ rule, file: relative(ROOT, file), line: line + 1, detail });
}

function walkDir(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".react-router" || entry === "build") continue;
      walkDir(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const isTestPath = (p: string) =>
  /__tests__/.test(p) || /\.test\.tsx?$/.test(p) || /\.test-layer\.ts$/.test(p);

/**
 * Files where throwing IS the documented contract. `throw` is how these layers
 * are specified to work, so flagging them would be flagging the framework.
 */
const THROW_BOUNDARY = [
  "app/trpc/index.ts", // tRPC middleware / errorFormatter contract
  "app/lib/effect-trpc.ts", // the designated Effect -> tRPC edge
];

/**
 * Vendored ShadCN primitives. Their context guards
 * (`throw new Error("useX must be used within <X>")`) are the idiomatic React
 * pattern and are upstream's code, not this repo's business logic. Exempting the
 * directory is honest; rewriting vendored files to use Effect is not.
 */
const VENDORED_UI = "app/components/ui/";

function inBoundary(file: string) {
  const rel = relative(ROOT, file);
  return THROW_BOUNDARY.some((b) => rel === b);
}

function isVendoredUi(file: string) {
  return relative(ROOT, file).startsWith(VENDORED_UI);
}

/**
 * `throw redirect(...)` / `throw data(...)` is React Router's *control flow*, not
 * an error path — a loader has no other way to redirect. Same category as
 * `throw new TRPCError` at the tRPC edge: framework contract, not a violation.
 */
const FRAMEWORK_THROW_CALLEES = new Set(["redirect", "redirectDocument", "data"]);

/** Names imported from react-router in this file — the only ones that count. */
function reactRouterImports(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  ts.forEachChild(sf, (node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier)) return;
    if (!/^react-router(\/|$)/.test(node.moduleSpecifier.text)) return;
    const clause = node.importClause;
    if (!clause) return;
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) names.add(el.name.text);
    }
  });
  return names;
}

/**
 * `throw redirect(...)` counts only when `redirect` was IMPORTED FROM
 * react-router. Matching on the bare name let a local `const data = (e) => e`
 * exempt `throw data(err)` — the allowance was attacker-controlled.
 */
function isFrameworkControlFlowThrow(node: ts.ThrowStatement, imported: Set<string>): boolean {
  const expr = node.expression;
  if (!expr || !ts.isCallExpression(expr)) return false;
  const callee = expr.expression;
  if (!ts.isIdentifier(callee)) return false;
  return FRAMEWORK_THROW_CALLEES.has(callee.text) && imported.has(callee.text);
}

/**
 * try/catch that predates this gate. The old CI sweep never checked try/catch at
 * all, so these were never enforced. Each is real debt against non-negotiable #1;
 * the list makes it enumerable instead of invisible. Removing an entry (by
 * converting to Effect.tryPromise) is the only correct direction — adding one
 * needs a run-note justification.
 */
const TRY_CATCH_GRANDFATHERED = new Set([
  "app/routes/admin/components/user-data-table.tsx",
  "app/routes/authentication/components/login-form.tsx",
  "app/routes/authentication/components/signup-form.tsx",
  "workers/app.ts",
]);

/**
 * Is this node inside an `Effect.tryPromise` / `Effect.try` callback?
 *
 * The RECEIVER matters. Checking only the method name meant any object with a
 * `.try()` — `foo.try(() => { throw e })` — exempted the throw, so the escape
 * hatch was attacker-controlled.
 */
const EFFECT_TRY_METHODS = new Set(["tryPromise", "try", "tryMap", "tryMapPromise"]);

function insideEffectTry(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
      if (!EFFECT_TRY_METHODS.has(p.expression.name.text)) continue;
      const recv = p.expression.expression;
      // Effect.tryPromise(...) or SomeNamespace.Effect.tryPromise(...)
      const recvName = ts.isIdentifier(recv)
        ? recv.text
        : ts.isPropertyAccessExpression(recv)
          ? recv.name.text
          : null;
      if (recvName === "Effect") return true;
    }
  }
  return false;
}

function checkSourceFile(file: string, sf: ts.SourceFile) {
  const rel = relative(ROOT, file);
  const routerImports = reactRouterImports(sf);

  const visit = (node: ts.Node) => {
    // --- 1. no bare throw -------------------------------------------------
    if (ts.isThrowStatement(node)) {
      const allowed =
        insideEffectTry(node) || // the documented escape
        inBoundary(file) || // designated Effect -> tRPC / tRPC middleware edge
        isVendoredUi(file) || // vendored ShadCN context guards
        isFrameworkControlFlowThrow(node, routerImports); // React Router `throw redirect(...)`
      if (!allowed) {
        add(
          "1-effect-ts",
          file,
          node,
          sf,
          "bare `throw` — use Effect.fail (or throw inside Effect.tryPromise). " +
            `Allowed only at ${THROW_BOUNDARY.join(", ")}, in ${VENDORED_UI}, or as framework control flow (throw redirect(...))`
        );
      }
    }

    // --- 1b. no try/catch outside Effect.tryPromise ------------------------
    if (
      ts.isTryStatement(node) &&
      !insideEffectTry(node) &&
      !isVendoredUi(file) &&
      !TRY_CATCH_GRANDFATHERED.has(rel)
    ) {
      add(
        "1-effect-ts",
        file,
        node,
        sf,
        "`try`/`catch` — wrap the failing call in Effect.tryPromise instead"
      );
    }

    // --- 1c. Effect.promise on something that can reject -------------------
    // Effect.promise assumes the promise NEVER rejects; a rejection escapes the
    // Effect error channel entirely and becomes an unhandled defect.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Effect" &&
      node.expression.name.text === "promise"
    ) {
      add(
        "1-effect-ts",
        file,
        node,
        sf,
        "Effect.promise assumes the promise cannot reject — use Effect.tryPromise unless that is provably true (then add `// effect-promise-ok: <why>`)"
      );
    }

    // --- 2. no Zod --------------------------------------------------------
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (spec === "zod" || spec.startsWith("zod/")) {
        add("2-effect-schema", file, node, sf, `imports "${spec}" — use Effect Schema`);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      /^zod(\/|$)/.test(node.arguments[0].text)
    ) {
      add("2-effect-schema", file, node, sf, "require()s zod — use Effect Schema");
    }
    // await import("zod") — a dynamic import is still an import. Checking only
    // static declarations and require() let this through untouched.
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      /^zod(\/|$)/.test(node.arguments[0].text)
    ) {
      add("2-effect-schema", file, node, sf, "dynamically imports zod — use Effect Schema");
    }

    // --- 5. no process.env ------------------------------------------------
    // Three spellings, all equivalent at runtime. Checking only the first let
    // `process["env"]` and `const { env } = process` straight through.
    const PROCESS_ENV_MSG =
      "process.env — Workers has no process; use the CloudflareEnv Tag or context.cloudflare.env";

    // process.env
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      node.name.text === "env"
    ) {
      add("5-cloudflare", file, node, sf, PROCESS_ENV_MSG);
    }

    // globalThis.process.env — the same access with one more hop.
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "process" &&
      ts.isIdentifier(node.expression.expression) &&
      (node.expression.expression.text === "globalThis" || node.expression.expression.text === "global")
    ) {
      add("5-cloudflare", file, node, sf, `globalThis.process.env — ${PROCESS_ENV_MSG}`);
    }

    // process["env"] / process['env']
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "env"
    ) {
      add("5-cloudflare", file, node, sf, `process["env"] — ${PROCESS_ENV_MSG}`);
    }

    // const { env } = process   /   const { env: e } = process
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === "process" &&
      node.name &&
      ts.isObjectBindingPattern(node.name)
    ) {
      const bindsEnv = node.name.elements.some((el) => {
        const key = el.propertyName ?? el.name;
        return ts.isIdentifier(key) && key.text === "env";
      });
      if (bindsEnv) {
        add("5-cloudflare", file, node, sf, `destructures env off process — ${PROCESS_ENV_MSG}`);
      }
    }

    ts.forEachChild(node, visit);
  };

  // Narrow, documented escape for Effect.promise — LINE-SCOPED.
  //
  // It was file-scoped: one `// effect-promise-ok:` comment anywhere exempted
  // every Effect.promise in the file, so a single justified use silently
  // licensed unlimited unjustified ones. The marker must now sit on the same
  // line or the line directly above the call it excuses.
  const lines = sf.getFullText().split("\n");
  const exemptLines = new Set<number>();
  lines.forEach((l, i) => {
    if (/effect-promise-ok:/.test(l)) {
      exemptLines.add(i + 1); // same line
      exemptLines.add(i + 2); // the line below the comment
    }
  });
  const before = violations.length;
  visit(sf);
  for (let i = violations.length - 1; i >= before; i--) {
    if (violations[i].detail.startsWith("Effect.promise") && exemptLines.has(violations[i].line)) {
      violations.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. every tagged error is mapped in tagToTRPC
// ---------------------------------------------------------------------------
function checkTaggedErrorsMapped() {
  const errDir = join(ROOT, "app/models/errors");
  const mapFile = join(ROOT, "app/lib/effect-trpc.ts");
  if (!existsSync(errDir) || !existsSync(mapFile)) return;

  /**
   * Collect the tags the mapper actually BRANCHES on, by AST — `case "X":`
   * labels and `_tag === "X"` comparisons.
   *
   * This was `mapText.includes(name)`, which a bare comment satisfied: writing
   * `// ProbeError mapped` in effect-trpc.ts made the gate pass with no mapping
   * at all. A substring search cannot tell code from prose.
   */
  const mapped = new Set<string>();
  const mapSf = ts.createSourceFile(mapFile, readFileSync(mapFile, "utf8"), ts.ScriptTarget.Latest, true);
  const collect = (n: ts.Node) => {
    if (ts.isCaseClause(n) && ts.isStringLiteralLike(n.expression)) mapped.add(n.expression.text);
    if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
    ) {
      for (const [a, b] of [
        [n.left, n.right],
        [n.right, n.left],
      ] as const) {
        const isTagRef =
          (ts.isPropertyAccessExpression(a) && a.name.text === "_tag") ||
          (ts.isElementAccessExpression(a) &&
            a.argumentExpression &&
            ts.isStringLiteralLike(a.argumentExpression) &&
            a.argumentExpression.text === "_tag");
        if (isTagRef && ts.isStringLiteralLike(b)) mapped.add(b.text);
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(mapSf);

  for (const file of walkDir(errDir)) {
    if (isTestPath(file)) continue;
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    ts.forEachChild(sf, (node) => {
      // class X extends Data.TaggedError("X")<...> {}
      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text;
        // The runtime discriminant is the STRING passed to TaggedError("..."),
        // not the class name. Comparing the class name let
        // `class Foo extends Data.TaggedError("Bar")` pass on a `case "Foo":`
        // that can never match — a mapping dead at runtime satisfying the gate.
        let tag: string | null = null;
        const heritage = node.heritageClauses?.some((h) =>
          h.types.some((t) => {
            const text = t.expression.getText(sf);
            if (!/TaggedError/.test(text)) return false;
            if (ts.isCallExpression(t.expression) && t.expression.arguments.length) {
              const arg = t.expression.arguments[0];
              if (ts.isStringLiteralLike(arg)) tag = arg.text;
            }
            return true;
          })
        );
        const key = tag ?? name;
        if (tag && tag !== name) {
          // Not a violation by itself, but it is a trap worth naming.
          if (!mapped.has(tag))
            add(
              "3-tagged-errors",
              file,
              node,
              sf,
              `class ${name} has runtime tag "${tag}" — app/lib/effect-trpc.ts must branch on "${tag}", not the class name`
            );
        } else if (heritage && !mapped.has(key)) {
          add(
            "3-tagged-errors",
            file,
            node,
            sf,
            `tagged error ${name} is not referenced in app/lib/effect-trpc.ts — add it to the tag -> HTTP mapping`
          );
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 4. unit test for every helper and repository — the rule with NO gate before
// ---------------------------------------------------------------------------

/**
 * Grandfathered files that predate the gate. Every entry is a real violation of
 * non-negotiable #4, kept here so the gate can land without a red build. Deleting
 * an entry (by writing the test) is the only correct direction; adding one needs
 * a run-note justification.
 */
const TEST_PARITY_GRANDFATHERED = new Set(["app/lib/effect-form.ts", "app/lib/logger.ts"]);

function hasExportedValue(sf: ts.SourceFile): boolean {
  let found = false;
  ts.forEachChild(sf, (node) => {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const exported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) return;
    // Type-only exports need no test.
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return;
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableStatement(node))
      found = true;
  });
  return found;
}

function checkTestParity() {
  const targets = [join(ROOT, "app/lib"), join(ROOT, "app/repositories")];
  for (const dir of targets) {
    if (!existsSync(dir)) continue;
    // RECURSIVE: `app/lib/constants/` and `app/lib/schemas/` escaped a
    // top-level-only scan entirely, so whole subtrees were ungated.
    for (const full of walkDir(dir)) {
      if (!/\.ts$/.test(full) || isTestPath(full)) continue;
      const file = basename(full);
      const rel = relative(ROOT, full);
      if (TEST_PARITY_GRANDFATHERED.has(rel)) continue;

      const sf = ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
      if (!hasExportedValue(sf)) continue; // types-only module

      const stem = basename(file, ".ts");
      const candidates = [
        join(dirname(full), "__tests__", `${stem}.test.ts`),
        join(dirname(full), `${stem}.test.ts`),
      ];
      // An EMPTY test file used to satisfy this — existence is not coverage.
      const found = candidates.find(existsSync);
      if (found) {
        const testSrc = readFileSync(found, "utf8");
        if (testSrc.trim().length < 40) {
          violations.push({
            rule: "4-unit-tests",
            file: relative(ROOT, found),
            line: 1,
            detail: "test file is effectively empty — existence is not coverage",
          });
          continue;
        }
        // It must actually IMPORT the module it claims to test. A file of the
        // right name testing something else satisfied the gate otherwise.
        const importsSubject = new RegExp(
          `(from|import)\\s*\\(?\\s*["'\`][^"'\`]*\\b${stem.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")}(\\.js|\\.ts)?["'\`]`
        ).test(testSrc);
        if (!importsSubject) {
          violations.push({
            rule: "4-unit-tests",
            file: relative(ROOT, found),
            line: 1,
            detail: `never imports "${stem}" — a test that does not load the module under test is not coverage`,
          });
          continue;
        }
      }
      if (!found) {
        violations.push({
          rule: "4-unit-tests",
          file: rel,
          line: 1,
          detail: `exports values but has no sibling __tests__/${stem}.test.ts — non-negotiable #4`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test — a gate with no failing fixture is a claim, not a check
// ---------------------------------------------------------------------------
function selftest() {
  const cases: Array<{ name: string; code: string; expect: string }> = [
    { name: "bare throw (grep missed: no `new`)", code: "export function f(e: Error) { throw e; }", expect: "1-effect-ts" },
    { name: "throw new Error", code: "export function f() { throw new Error('x'); }", expect: "1-effect-ts" },
    { name: "bare try/catch (never checked before)", code: "export function f() { try { g(); } catch {} }", expect: "1-effect-ts" },
    { name: "single-quoted zod (grep was double-quote only)", code: "import { z } from 'zod';", expect: "2-effect-schema" },
    { name: "double-quoted zod", code: 'import { z } from "zod";', expect: "2-effect-schema" },
    { name: "zod subpath", code: "import { z } from 'zod/v4';", expect: "2-effect-schema" },
    { name: "Effect.promise (never checked before)", code: "export const a = Effect.promise(() => p());", expect: "1-effect-ts" },
    { name: "process.env", code: "export const a = process.env.FOO;", expect: "5-cloudflare" },
    { name: "throw inside Effect.tryPromise is ALLOWED", code: "export const a = Effect.tryPromise({ try: () => { throw new Error('x'); }, catch: (e) => e });", expect: "" },

    // Bypasses found by adversarial review AFTER the first version shipped.
    // Each walked straight through the checks above.
    { name: 'process["env"] element access', code: 'export const a = process["env"].FOO;', expect: "5-cloudflare" },
    { name: "process['env'] single-quoted", code: "export const a = process['env'];", expect: "5-cloudflare" },
    { name: "const { env } = process destructuring", code: "const { env } = process; export const a = env.FOO;", expect: "5-cloudflare" },
    { name: "const { env: e } = process renamed", code: "const { env: e } = process; export const a = e;", expect: "5-cloudflare" },
    { name: 'await import("zod") dynamic import', code: 'export const a = async () => (await import("zod")).z;', expect: "2-effect-schema" },
    { name: "dynamic import of a zod subpath", code: "export const a = async () => await import('zod/v4');", expect: "2-effect-schema" },
    { name: "process.versions is NOT process.env", code: "export const a = process.versions;", expect: "" },
    { name: "an unrelated destructure off process is fine", code: "const { argv } = process; export const a = argv;", expect: "" },

    // effect-promise-ok is LINE-scoped: it used to be file-scoped, so one
    // justified use licensed every other use in the file.
    {
      name: "effect-promise-ok excuses the call on the next line",
      code: "// effect-promise-ok: cannot reject\nexport const a = Effect.promise(() => p());",
      expect: "",
    },
    // Attacker-controlled exemptions — each of these was clean before.
    { name: "throw data(err) with a LOCAL data() is not framework control flow", code: "const data = (e: unknown) => e;\nexport function f(err: Error) { throw data(err); }", expect: "1-effect-ts" },
    { name: "throw redirect() WITH the react-router import is allowed", code: 'import { redirect } from "react-router";\nexport function f() { throw redirect("/login"); }', expect: "" },
    { name: "throw redirect() WITHOUT the import is not", code: 'const redirect = (s: string) => s;\nexport function f() { throw redirect("/x"); }', expect: "1-effect-ts" },
    { name: "foo.try() on a non-Effect receiver does not exempt a throw", code: "export const a = foo.try(() => { throw new Error('x'); });", expect: "1-effect-ts" },
    { name: "Effect.try() DOES exempt a throw", code: "export const a = Effect.try(() => { throw new Error('x'); });", expect: "" },
    { name: "globalThis.process.env", code: "export const a = globalThis.process.env.FOO;", expect: "5-cloudflare" },
    {
      name: "effect-promise-ok does NOT excuse a call 5 lines away",
      code: "// effect-promise-ok: cannot reject\nexport const a = Effect.promise(() => p());\nconst x = 1;\nconst y = 2;\nexport const b = Effect.promise(() => q());",
      expect: "1-effect-ts",
    },
  ];

  let failed = 0;
  for (const c of cases) {
    violations.length = 0;
    const sf = ts.createSourceFile("selftest.ts", c.code, ts.ScriptTarget.Latest, true);
    checkSourceFile(join(ROOT, "selftest.ts"), sf);
    const hit = violations.some((v) => v.rule === c.expect);
    const clean = violations.length === 0;
    const pass = c.expect === "" ? clean : hit;
    if (!pass) {
      failed++;
      console.error(
        `  selftest FAIL: ${c.name} — expected ${c.expect || "no violation"}, got ${
          violations.map((v) => v.rule).join(",") || "none"
        }`
      );
    }
  }
  if (failed) {
    console.error(`non-negotiables selftest: ${failed}/${cases.length} case(s) failed`);
    process.exit(1);
  }
  console.log(
    `non-negotiables selftest: ok — ${cases.length} fixtures (each one the grep sweep missed, or a bypass adversarial review found in this checker)`
  );
}

// ---------------------------------------------------------------------------

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const files = [...walkDir(join(ROOT, "app")), ...walkDir(join(ROOT, "workers"))].filter(
    (f) => !isTestPath(f)
  );
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    checkSourceFile(file, sf);
  }
  checkTaggedErrorsMapped();
  checkTestParity();

  if (violations.length) {
    console.error(`Five non-negotiables: ${violations.length} violation(s)`);
    const byRule = new Map<string, Violation[]>();
    for (const v of violations) {
      if (!byRule.has(v.rule)) byRule.set(v.rule, []);
      byRule.get(v.rule)!.push(v);
    }
    for (const [rule, vs] of [...byRule.entries()].sort()) {
      console.error(`\n  ${rule} (${vs.length}):`);
      for (const v of vs) console.error(`    ${v.file}:${v.line} — ${v.detail}`);
    }
    console.error(
      `\n  ${files.length} source file(s) swept. Grandfathered for #4: ${
        [...TEST_PARITY_GRANDFATHERED].join(", ") || "none"
      }`
    );
    process.exit(1);
  }
  console.log(
    `Five non-negotiables: clean — ${files.length} source file(s), AST-swept (throw, try/catch, Effect.promise, zod, process.env, tagged-error mapping, test parity)`
  );
}
