import ts from "typescript";
import { ERROR_MAP_FILE, ERRORS_DIR } from "../constants";
import { isSourcePath, isTestPath, lineOf } from "../source";
import type { Hit, RepoRule, Source } from "../types";

const MAPPER_NAMES = ["tagToTRPC", "appErrorToTRPC", "toTRPC"];
const TAG_PROPERTY = "_tag";
const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken]);

const isFunctionNode = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

function mapperNodes(ast: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    const name =
      ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) ? node.name : undefined;
    if (name && ts.isIdentifier(name) && MAPPER_NAMES.includes(name.text)) found.push(node);
    node.forEachChild(visit);
  };
  visit(ast);
  return found;
}

function readsTag(node: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === TAG_PROPERTY;
  return (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === TAG_PROPERTY
  );
}

function branchedTags(mappers: ts.Node[]): Set<string> {
  const tags = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isCaseClause(node) && ts.isStringLiteralLike(node.expression)) tags.add(node.expression.text);
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)) {
      if (readsTag(node.left) && ts.isStringLiteralLike(node.right)) tags.add(node.right.text);
      if (readsTag(node.right) && ts.isStringLiteralLike(node.left)) tags.add(node.left.text);
    }
    node.forEachChild((child) => {
      if (isFunctionNode(child) && !mappers.includes(child)) return;
      collect(child);
    });
  };
  for (const mapper of mappers) mapper.forEachChild(collect);
  return tags;
}

function taggedErrorTag(node: ts.ClassDeclaration, ast: ts.SourceFile): { tagged: boolean; tag?: string } {
  let tag: string | undefined;
  const tagged =
    node.heritageClauses?.some((clause) =>
      clause.types.some((type) => {
        if (!/TaggedError/.test(type.expression.getText(ast))) return false;
        const first = ts.isCallExpression(type.expression) ? type.expression.arguments[0] : undefined;
        if (first && ts.isStringLiteralLike(first)) tag = first.text;
        return true;
      })
    ) ?? false;
  return { tagged, tag };
}

function unmappedErrors(source: Source, mapped: Set<string>): Hit[] {
  const hits: Hit[] = [];
  for (const node of source.ast.statements) {
    if (!ts.isClassDeclaration(node) || !node.name) continue;
    const name = node.name.text;
    const { tagged, tag } = taggedErrorTag(node, source.ast);
    const line = lineOf(source.ast, node);
    if (tag && tag !== name) {
      if (mapped.has(tag)) continue;
      hits.push({
        file: source.path,
        line,
        message: `class ${name} has the runtime tag "${tag}", and ${ERROR_MAP_FILE} has no branch on "${tag}"`,
        fix: `add \`case "${tag}":\` to the switch in \`appErrorToTRPC\` in ${ERROR_MAP_FILE}; the switch reads the runtime tag, not the class name`,
      });
    } else if (tagged && !mapped.has(name)) {
      hits.push({ file: source.path, line, message: `tagged error ${name} has no branch in ${ERROR_MAP_FILE}` });
    }
  }
  return hits;
}

const error = (name: string, tag = name): string =>
  `import { Data } from "effect";\nexport class ${name} extends Data.TaggedError("${tag}")<{}> {}\n`;

const tree = (mapper: string, errorFile = error("BoomError")): Record<string, string> => ({
  [`${ERRORS_DIR}/boom.ts`]: errorFile,
  [ERROR_MAP_FILE]: mapper,
});

export const rule: RepoRule = {
  id: "tagged-error-mapped",
  scope: "repo",
  nonNegotiable: 3,
  matches: `A \`Data.TaggedError\` class in \`${ERRORS_DIR}/\` whose runtime tag has no \`case\` or \`_tag ===\` branch inside the mapper in \`${ERROR_MAP_FILE}\`.`,
  covers: `\`${ERRORS_DIR}/\` against \`${ERROR_MAP_FILE}\`.`,
  fix: `add the tag to \`APP_ERROR_TAGS\` and a \`case "<Tag>":\` that returns a \`TRPCError\` to the switch in \`appErrorToTRPC\` in ${ERROR_MAP_FILE}`,
  example: ERROR_MAP_FILE,
  check(repo) {
    const errorFiles = repo.files(ERRORS_DIR).filter((path) => isSourcePath(path) && !isTestPath(path));
    const mapSource = repo.source(ERROR_MAP_FILE);
    if (errorFiles.length === 0 || !mapSource) return [];
    const mappers = mapperNodes(mapSource.ast);
    const hits: Hit[] = [];
    if (mappers.length === 0) {
      hits.push({
        file: ERROR_MAP_FILE,
        line: 1,
        message: `no mapper function found (looked for ${MAPPER_NAMES.join(", ")}), so no tag can be checked`,
        fix: `keep the tag switch in a function named \`appErrorToTRPC\` in ${ERROR_MAP_FILE}`,
      });
    }
    const mapped = branchedTags(mappers);
    for (const path of errorFiles) {
      const source = repo.source(path);
      if (source) hits.push(...unmappedErrors(source, mapped));
    }
    return hits;
  },
  cases: [
    {
      name: "a tagged error absent from the mapper is caught",
      files: tree('export function tagToTRPC(t: string) { switch (t) { case "OtherError": return 1; } }'),
      expect: "finding",
    },
    {
      name: "a tagged error with a case branch is clean",
      files: tree('export function tagToTRPC(t: string) { switch (t) { case "BoomError": return 1; } }'),
      expect: "clean",
    },
    {
      name: "a comment that names the error is not a mapping",
      files: tree("export function tagToTRPC(t: string) { /* BoomError mapped */ return 0; }"),
      expect: "finding",
    },
    {
      name: "a case branch in a nested function nobody calls is not a mapping",
      files: tree(
        'export function tagToTRPC(t: string) {\n  function unused(x: string) { switch (x) { case "BoomError": return 9; } }\n  return 0;\n}'
      ),
      expect: "finding",
    },
    {
      name: "a case branch outside the mapper is not a mapping",
      files: tree(
        'export function other(x: string) { switch (x) { case "BoomError": return 9; } }\nexport function tagToTRPC(t: string) { return 0; }'
      ),
      expect: "finding",
    },
    {
      name: '`_tag === "X"` counts as a branch',
      files: tree('export function tagToTRPC(e: any) { if (e._tag === "BoomError") return 1; return 0; }'),
      expect: "clean",
    },
    {
      name: "a runtime tag that differs from the class name must be the one mapped",
      files: tree('export function tagToTRPC(t: string) { switch (t) { case "BoomError": return 1; } }', error("BoomError", "boom_failed")),
      expect: "finding",
    },
    {
      name: "a missing mapper function is a finding",
      files: tree("export const somethingElse = 1;"),
      expect: "finding",
    },
  ],
};
