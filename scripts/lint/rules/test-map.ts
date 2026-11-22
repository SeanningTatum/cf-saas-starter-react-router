import { Either } from "effect";
import { E2E_DIR, E2E_SPEC, ROUTER_FILE, ROUTES_FILE, TEST_MAP_KINDS, TEST_MAP_PATH, TEST_MAP_ROOTS } from "../constants";
import { isSourcePath, isTestPath } from "../source";
import { testMapCases } from "../test-map/cases";
import { parseTestMap, type MapEntry, type TestMap } from "../test-map/map";
import { procedureProblems } from "../test-map/procedure";
import {
  coveredByProblems,
  declarationProblems,
  machineProblems,
  sandboxProblems,
  specHelperProblems,
  testSupportProblems,
  unitProblems,
  type Problem,
} from "../test-map/proofs";
import { routeProblems } from "../test-map/route";
import type { Hit, Repo, RepoRule } from "../types";

const mapHit = (message: string, fix: string): Hit => ({ file: TEST_MAP_PATH, line: 1, message, fix });

export function proofProblems(repo: Repo, path: string, entry: MapEntry): Problem[] {
  switch (entry.kind) {
    case "unit":
      return unitProblems(repo, path);
    case "machine":
      return machineProblems(repo, path);
    case "procedure":
      return procedureProblems(repo, path);
    case "route":
      return routeProblems(repo, path);
    case "component":
    case "primitive":
      return sandboxProblems(repo, path);
    case "declaration":
      return declarationProblems(repo, path);
    case "spec-helper":
      return specHelperProblems(repo, path);
    case "covered-by":
      return coveredByProblems(repo, entry);
  }
}

function fileHits(repo: Repo, map: TestMap, path: string): Hit[] {
  const entry = map.classify(path);
  if (!entry) {
    return [
      {
        file: path,
        line: 1,
        related: [TEST_MAP_PATH],
        message: `no entry in ${TEST_MAP_PATH} matches this file, so it is unclassified`,
        fix:
          `add \`{ "match": "<glob for its folder>", "kind": "<kind>" }\` to ${TEST_MAP_PATH}; the first matching entry wins. ` +
          `Kinds: ${TEST_MAP_KINDS.join(", ")}`,
      },
    ];
  }
  return [...proofProblems(repo, path, entry), ...testSupportProblems(repo, path)].map((problem) => ({
    file: problem.file ?? path,
    line: problem.line ?? 1,
    message: `${entry.kind}: ${problem.message}`,
    fix: problem.fix,
    example: problem.example,
    related: [path, TEST_MAP_PATH, ...(problem.related ?? [])],
  }));
}

const SHARED_PROOFS = [TEST_MAP_PATH, ROUTES_FILE, ROUTER_FILE];

const isProof = (path: string): boolean => isTestPath(path) || path.startsWith(`${E2E_DIR}/`) || SHARED_PROOFS.includes(path);

const isClassified = (path: string): boolean => isSourcePath(path) && !isTestPath(path) && !E2E_SPEC.test(path);

export const rule: RepoRule = {
  id: "test-map",
  scope: "repo",
  nonNegotiable: 4,
  matches:
    `A source file that matches no entry in \`${TEST_MAP_PATH}\`, or whose kind's proof is missing: ` +
    "`unit` a `__tests__/<name>.test.ts` that imports it and asserts; `machine` that and an `e2e/<name>.paths.spec.ts`; " +
    "`procedure` a `LEVELS` entry and a test that calls it through the router; `route` an e2e spec that holds a `@golden` and an `@error` test and visits its path; " +
    "`component` and `primitive` a sandbox entry; `declaration` no code that runs; `spec-helper` an e2e spec that imports it; `covered-by` a named test that exists and asserts. " +
    "Also a source file that imports test support.",
  covers: `Every \`.ts\` and \`.tsx\` file under ${TEST_MAP_ROOTS.map((root) => `\`${root}/\``).join(", ")}, except tests, e2e specs and unit-test helpers.`,
  fix: `give the file the proof its kind names; \`${TEST_MAP_PATH}\` says which kind each folder is`,
  check(repo, only) {
    const text = repo.read(TEST_MAP_PATH);
    if (text === undefined) return [mapHit(`${TEST_MAP_PATH} is missing`, 'create it with `{ "entries": [] }` and add one entry per folder')];
    const parsed = parseTestMap(text);
    if (Either.isLeft(parsed)) {
      return parsed.left.map((problem) => mapHit(problem, 'each entry is `{ "match": "<glob>", "kind": "<kind>" }`; "covered-by" adds `test` and `reason`'));
    }
    const map = parsed.right;
    const files = TEST_MAP_ROOTS.flatMap((root) => repo.files(root)).filter(isClassified);
    if (only && ![...only].some(isProof)) return files.filter((path) => only.has(path)).flatMap((path) => fileHits(repo, map, path));
    const used = new Set(files.map((path) => map.classify(path)));
    const stale = map.entries
      .filter((entry) => !used.has(entry))
      .map((entry) => mapHit(`the entry for "${entry.match}" matches no file`, "delete the entry, or fix its glob; an earlier entry may match the same files first"));
    return [...files.flatMap((path) => fileHits(repo, map, path)), ...stale];
  },
  cases: testMapCases,
};
