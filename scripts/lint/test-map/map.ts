import { Either, Schema } from "effect";
import { TEST_MAP_KINDS } from "../constants";
import { globToRegExp } from "./glob";

const Entry = Schema.Struct({
  match: Schema.NonEmptyTrimmedString,
  kind: Schema.NonEmptyTrimmedString,
  test: Schema.optional(Schema.NonEmptyTrimmedString),
  reason: Schema.optional(Schema.NonEmptyTrimmedString),
});

const MapFile = Schema.parseJson(Schema.Struct({ entries: Schema.Array(Entry) }));

export type Kind = (typeof TEST_MAP_KINDS)[number];
type RawEntry = typeof Entry.Type;
export type MapEntry = Omit<RawEntry, "kind"> & { kind: Kind };

const isKind = (kind: string): kind is Kind => TEST_MAP_KINDS.some((known) => known === kind);

export interface TestMap {
  entries: readonly MapEntry[];
  classify(path: string): MapEntry | undefined;
}

function entryProblems(entry: RawEntry): string[] {
  const named = `the entry for "${entry.match}"`;
  if (!isKind(entry.kind)) return [`${named} has the kind "${entry.kind}"; the kinds are ${TEST_MAP_KINDS.join(", ")}`];
  if (entry.kind === "covered-by") {
    return entry.test && entry.reason ? [] : [`${named} is "covered-by" and needs both \`test\` (a test file's path) and \`reason\``];
  }
  return entry.test || entry.reason ? [`${named} is "${entry.kind}", so it takes no \`test\` or \`reason\`; only "covered-by" does`] : [];
}

export function parseTestMap(text: string): Either.Either<TestMap, string[]> {
  const decoded = Schema.decodeUnknownEither(MapFile, { onExcessProperty: "error" })(text);
  if (Either.isLeft(decoded)) return Either.left([`the map does not parse: ${decoded.left.message.split("\n").join(" ")}`]);
  const problems = decoded.right.entries.flatMap(entryProblems);
  if (problems.length > 0) return Either.left(problems);
  const entries = decoded.right.entries.flatMap((entry): MapEntry[] => (isKind(entry.kind) ? [{ ...entry, kind: entry.kind }] : []));
  const compiled = entries.map((entry) => ({ entry, pattern: globToRegExp(entry.match) }));
  return Either.right({
    entries,
    classify: (path) => compiled.find(({ pattern }) => pattern.test(path))?.entry,
  });
}
