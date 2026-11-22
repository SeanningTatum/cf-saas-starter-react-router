import ts from "typescript";
import { E2E_DIR, E2E_SPEC, ROUTES_FILE, SMOKE_TAGS, TEST_MAP_PATH } from "../constants";
import { walkNodes } from "../source";
import type { Repo } from "../types";
import { asserts, type Problem } from "./proofs";
import { routePaths } from "./routes";

interface SpecFacts {
  path: string;
  smoke: boolean;
  visits: string[];
  paths: string[];
}

const PARAMETER = /^:/;
const WILDCARD = "*";
const segmentsOf = (path: string): string[] => path.split("/").filter(Boolean);

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
      const heads: string[] = [];
      walkNodes(spec.ast, (node) => {
        if (ts.isStringLiteralLike(node)) strings.add(node.text);
        if (ts.isTemplateExpression(node)) heads.push(node.head.text);
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
        const [target] = node.arguments;
        if (node.expression.name.text === "goto" && target && ts.isStringLiteralLike(target)) visits.push(target.text);
      });
      const paths = [...strings, ...heads].filter((text) => text.startsWith("/"));
      return [{ path, smoke: asserts(spec) && SMOKE_TAGS.every((tag) => strings.has(tag)), visits, paths }];
    });
}

function specFacts(repo: Repo): SpecFacts[] {
  const known = specsByRepo.get(repo) ?? readSpecs(repo);
  specsByRepo.set(repo, known);
  return known;
}

export function visitsPath(visited: string, pattern: string): boolean {
  const url = segmentsOf(visited.split(/[?#]/)[0] ?? "");
  const route = segmentsOf(pattern);
  const open = route.at(-1) === WILDCARD;
  const fixed = open ? route.slice(0, -1) : route;
  if (open ? url.length < fixed.length : url.length !== fixed.length) return false;
  return fixed.every((segment, index) => PARAMETER.test(segment) || segment === url[index]);
}

const isPattern = (path: string): boolean => segmentsOf(path).some((segment) => PARAMETER.test(segment) || segment === WILDCARD);

export function specsVisiting(repo: Repo, path: string): string[] {
  const table = repo.source(ROUTES_FILE);
  const paths = (table ? routePaths(table) : new Map<string, string[]>()).get(path) ?? [];
  return specFacts(repo)
    .filter((spec) => [...spec.visits, ...spec.paths].some((visited) => paths.some((own) => visitsPath(visited, own))))
    .map((spec) => spec.path);
}

export function routeProblems(repo: Repo, path: string): Problem[] {
  const table = repo.source(ROUTES_FILE);
  const served = table ? routePaths(table) : new Map<string, string[]>();
  const paths = served.get(path) ?? [];
  const fixedPaths = new Set([...served.values()].flat().filter((own) => !isPattern(own)));
  const proves = (visited: string, own: string): boolean =>
    visitsPath(visited, own) && !(isPattern(own) && fixedPaths.has(`/${segmentsOf(visited.split(/[?#]/)[0] ?? "").join("/")}`));
  if (paths.length === 0) {
    return [{ message: `is classified as a route and ${ROUTES_FILE} does not list it`, fix: `add it to ${ROUTES_FILE}, or give it another kind in ${TEST_MAP_PATH}` }];
  }
  const specs = specFacts(repo);
  const proven = specs.some((spec) => spec.smoke && spec.visits.some((visited) => paths.some((own) => proves(visited, own))));
  if (proven) return [];
  const [first] = paths;
  return [
    {
      message: `no e2e spec that holds an ${SMOKE_TAGS.join(" and an ")} test visits ${paths.join(" or ")}`,
      fix: `add ${E2E_DIR}/<feature>.spec.ts with \`page.goto("${first}")\`, one test tagged \`{ tag: "@golden" }\` and one \`{ tag: "@error" }\`, each with an assertion`,
      related: [ROUTES_FILE, ...specs.map((spec) => spec.path)],
    },
  ];
}
