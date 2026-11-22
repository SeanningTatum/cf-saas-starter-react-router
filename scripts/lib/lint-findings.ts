import { Either, Schema } from "effect";
import {
  DEAD_CODE_FIX,
  FORMAT_CATEGORY,
  FORMAT_FIX,
  HOUSE_FINDING,
  LEGACY_HOUSE_FINDING,
  LEGACY_HOUSE_RULE_HEADING,
} from "./lint-constants";

export interface Finding {
  path: string;
  line?: number;
  column?: number;
  rule: string;
  message: string;
}

export function formatFinding(finding: Finding): string {
  const line = finding.line === undefined ? "" : `:${finding.line}`;
  const column = finding.line === undefined || finding.column === undefined ? "" : `:${finding.column}`;
  return `${finding.path}${line}${column} ${finding.rule}: ${finding.message}`;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0) ||
      a.rule.localeCompare(b.rule),
  );
}

const BiomePosition = Schema.Struct({ line: Schema.Number, column: Schema.Number });
const BiomeReport = Schema.parseJson(
  Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        severity: Schema.String,
        message: Schema.String,
        category: Schema.String,
        location: Schema.Struct({
          path: Schema.optional(Schema.NullOr(Schema.String)),
          start: Schema.optional(Schema.NullOr(BiomePosition)),
        }),
      }),
    ),
  }),
);

export function parseBiome(stdout: string): Either.Either<Finding[], string> {
  const decoded = Schema.decodeUnknownEither(BiomeReport)(stdout);
  if (Either.isLeft(decoded)) return Either.left("the output is not the JSON that `biome check --reporter=json` prints");
  return Either.right(
    decoded.right.diagnostics.map((diagnostic) => {
      const isFormat = diagnostic.category === FORMAT_CATEGORY;
      const start = diagnostic.location.start;
      const hasPosition = !isFormat && start !== undefined && start !== null && start.line > 0;
      return {
        path: diagnostic.location.path ?? "",
        ...(hasPosition ? { line: start.line, column: start.column } : {}),
        rule: diagnostic.category,
        message: isFormat ? FORMAT_FIX : diagnostic.message,
      };
    }),
  );
}

const KnipReport = Schema.parseJson(
  Schema.Struct({
    issues: Schema.Array(
      Schema.Struct({ file: Schema.String }, { key: Schema.String, value: Schema.Unknown }),
    ),
  }),
);
const KnipItem = Schema.Struct({
  name: Schema.String,
  line: Schema.optional(Schema.Number),
  col: Schema.optional(Schema.Number),
});
const KnipItems = Schema.Array(Schema.Union(KnipItem, Schema.Array(KnipItem)));

type DeadCodeKind = keyof typeof DEAD_CODE_FIX;
const DEAD_CODE_KINDS = Object.keys(DEAD_CODE_FIX) as DeadCodeKind[];

export function parseKnip(stdout: string): Either.Either<Finding[], string> {
  const decoded = Schema.decodeUnknownEither(KnipReport)(stdout);
  if (Either.isLeft(decoded)) return Either.left("the output is not the JSON that `knip --reporter json` prints");
  const findings: Finding[] = [];
  for (const issue of decoded.right.issues) {
    for (const kind of DEAD_CODE_KINDS) {
      const items = Schema.decodeUnknownEither(KnipItems)(issue[kind]);
      if (Either.isLeft(items)) continue;
      for (const item of items.right) {
        const group = "name" in item ? [item] : item;
        const [first] = group;
        if (first === undefined) continue;
        const names = group.map((entry) => entry.name).join(", ");
        const named = kind === "files" ? "" : `\`${names}\`: `;
        findings.push({
          path: issue.file,
          ...(first.line === undefined ? {} : { line: first.line, column: first.col }),
          rule: `knip/${kind}`,
          message: `${named}${DEAD_CODE_FIX[kind]}`,
        });
      }
    }
  }
  return Either.right(findings);
}

export function parseHouse(output: string): Finding[] {
  const findings: Finding[] = [];
  for (const line of output.split("\n")) {
    const match = HOUSE_FINDING.exec(line);
    if (match === null) continue;
    const [, path, lineNumber, column, rule, message] = match;
    if (path === undefined || lineNumber === undefined || rule === undefined || message === undefined) continue;
    findings.push({
      path,
      line: Number(lineNumber),
      ...(column === undefined ? {} : { column: Number(column) }),
      rule,
      message,
    });
  }
  return findings;
}

export function parseLegacyHouse(output: string): Finding[] {
  const findings: Finding[] = [];
  let rule = "house";
  for (const line of output.split("\n")) {
    const heading = LEGACY_HOUSE_RULE_HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      rule = `house/${heading[1].replace(/\s+/g, "-").toLowerCase()}`;
      continue;
    }
    const match = LEGACY_HOUSE_FINDING.exec(line);
    if (match === null) continue;
    const [, path, lineNumber, message] = match;
    if (path === undefined || lineNumber === undefined || message === undefined) continue;
    findings.push({ path, line: Number(lineNumber), rule, message });
  }
  return findings;
}
