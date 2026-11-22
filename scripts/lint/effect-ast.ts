import ts from "typescript";

const EFFECT_MODULE = "Effect";
const EFFECT_TRY_METHODS = new Set(["tryPromise", "try", "tryMap", "tryMapPromise"]);

export function effectAliases(ast: ts.SourceFile): Set<string> {
  const names = new Set<string>([EFFECT_MODULE]);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier !== "effect" && !specifier.startsWith("effect/")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    if (ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === EFFECT_MODULE) names.add(element.name.text);
      }
    }
  }
  return names;
}

export function isEffectReceiver(receiver: ts.Expression, ast: ts.SourceFile): boolean {
  const aliases = effectAliases(ast);
  if (ts.isIdentifier(receiver)) return aliases.has(receiver.text);
  if (ts.isPropertyAccessExpression(receiver)) return aliases.has(receiver.name.text);
  return false;
}

export function insideEffectTry(node: ts.Node, ast: ts.SourceFile): boolean {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (!ts.isCallExpression(parent) || !ts.isPropertyAccessExpression(parent.expression)) continue;
    if (!EFFECT_TRY_METHODS.has(parent.expression.name.text)) continue;
    if (isEffectReceiver(parent.expression.expression, ast)) return true;
  }
  return false;
}
