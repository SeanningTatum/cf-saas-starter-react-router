import ts from "typescript";

const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
]);
const SIGNS = new Set([ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken]);
const COLLECTIONS = new Set(["Set", "Map"]);

function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return unwrap(node.expression);
  return node;
}

function isScalar(node: ts.Expression): boolean {
  if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) || ts.isStringLiteral(node)) return true;
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isRegularExpressionLiteral(node)) return true;
  if (ts.isPrefixUnaryExpression(node)) return SIGNS.has(node.operator) && isLiteralValue(node.operand);
  return ts.isBinaryExpression(node) && ARITHMETIC.has(node.operatorToken.kind) && isLiteralValue(node.left) && isLiteralValue(node.right);
}

function isLiteralMember(property: ts.ObjectLiteralElementLike): boolean {
  return ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && isLiteralValue(property.initializer);
}

export function isLiteralValue(expression: ts.Expression): boolean {
  const node = unwrap(expression);
  if (isScalar(node)) return true;
  if (ts.isArrayLiteralExpression(node)) return node.elements.length > 0 && node.elements.every(isLiteralValue);
  if (ts.isObjectLiteralExpression(node)) return node.properties.length > 0 && node.properties.every(isLiteralMember);
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || !COLLECTIONS.has(node.expression.text)) return false;
  const [items] = node.arguments ?? [];
  return node.arguments?.length === 1 && items !== undefined && isLiteralValue(items);
}

const isExported = (statement: ts.VariableStatement): boolean =>
  ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

export function literalConstants(ast: ts.SourceFile, frameworkExports: ReadonlySet<string>): ts.VariableDeclaration[] {
  return ast.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) return [];
    const exported = isExported(statement);
    return statement.declarationList.declarations.filter((declaration) => {
      if (declaration.initializer === undefined || !isLiteralValue(declaration.initializer)) return false;
      return !(exported && ts.isIdentifier(declaration.name) && frameworkExports.has(declaration.name.text));
    });
  });
}
