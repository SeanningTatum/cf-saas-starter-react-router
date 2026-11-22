import ts from "typescript";
import { E2E_DIR, E2E_SPEC, ROUTES_FILE, SMOKE_TAGS, TEST_MAP_PATH } from "../constants";
import { walkNodes } from "../source";
import type { Repo } from "../types";
import { asserts, type Problem } from "./proofs";
import { routePaths } from "./routes";

interface SpecFacts {
  smoke: boolean;
  visits: string[];
}

const specsByRepo = new WeakMap<Repo, SpecFacts[]>();

function readSpecs(repo: Repo): SpecFacts[] {
  return repo
    .files(E2E_DIR)
    .filter((path) => E2E_SPEC.test(path))
    .flatMap((path) => {
      const spec = repo.source(path);
      if (!spec) return [];
      const strings = new Set<string>();
      const visits: string[] = [];
      walkNodes(spec.ast, (node) => {
        if (ts.isStringLiteralLike(node)) strings.add(node.text);
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
        const [target] = node.arguments;
        if (node.expression.name.text === "goto" && target && ts.isStringLiteralLike(target)) visits.push(target.text);
      });
      return [{ smoke: asserts(spec) && SMOKE_TAGS.every((tag) => strings.has(tag)), visits }];
    });
}

function specFacts(repo: Repo): SpecFacts[] {
  const known = specsByRepo.get(repo) ?? readSpecs(repo);
  specsByRepo.set(repo, known);
  return known;
}

export const visitsPath = (visited: string, path: string): boolean => visited.split(/[?#]/)[0] === path;

export function routeProblems(repo: Repo, path: string): Problem[] {
  const table = repo.source(ROUTES_FILE);
  const paths = (table ? routePaths(table).get(path) : undefined) ?? [];
  if (paths.length === 0) {
    return [{ message: `is classified as a route and ${ROUTES_FILE} does not list it`, fix: `add it to ${ROUTES_FILE}, or give it another kind in ${TEST_MAP_PATH}` }];
  }
  const proven = specFacts(repo).some((spec) => spec.smoke && spec.visits.some((visited) => paths.some((own) => visitsPath(visited, own))));
  if (proven) return [];
  const [first] = paths;
  return [
    {
      message: `no e2e spec that holds an ${SMOKE_TAGS.join(" and an ")} test visits ${paths.join(" or ")}`,
      fix: `add ${E2E_DIR}/<feature>.spec.ts with \`page.goto("${first}")\`, one test tagged \`{ tag: "@golden" }\` and one \`{ tag: "@error" }\`, each with an assertion`,
    },
  ];
}
