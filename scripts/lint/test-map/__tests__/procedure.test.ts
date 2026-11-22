import { describe, expect, it } from "vitest";
import { LEVELS_FILE, ROUTER_FILE } from "../../constants";
import { memoryRepo } from "../../repo";
import { sourceOf } from "../../__tests__/fixtures";
import { procedureNames, procedureProblems, routerKey } from "../procedure";

const notesRouter = () =>
  'import { adminProcedure, createTRPCRouter } from "..";\nimport { archive } from "./archive";\n' +
  "export const notesRouter = createTRPCRouter({ list: adminProcedure.query(() => []), archive });\n";

const appRouter = () =>
  'import { createTRPCRouter } from ".";\nimport { notesRouter } from "./routes/notes";\nimport { tagsRouter as tags } from "./routes/tags";\n' +
  "export const appRouter = createTRPCRouter({ notes: notesRouter, labels: tags });\n";

const levels = (...keys: string[]) => `const LEVELS = { ${keys.map((key) => `"${key}": "admin"`).join(", ")} };\n`;

const callingTest = () =>
  'import { expect, it } from "vitest";\nimport { appRouter } from "@/trpc/router";\n' +
  'it("lists", async () => { expect(await call(appRouter).notes.list()).toEqual([]); });\n';

const repoWith = (files: Record<string, string>) =>
  memoryRepo({ "app/trpc/routes/notes.ts": notesRouter(), [ROUTER_FILE]: appRouter(), ...files });

describe("procedureNames", () => {
  it("reads the keys of the router object, shorthand keys included, and no name from a plain helper", () => {
    const source = sourceOf(`${notesRouter()}const helper = makeHelper();\n`, "app/trpc/routes/notes.ts");

    expect(procedureNames(source)).toEqual({ routed: ["list", "archive"], standalone: [] });
  });

  it("reads a procedure exported on its own by the builder its chain starts from, whatever the chain's length", () => {
    const source = sourceOf(
      'export const dbHealth = adminProcedure.input(Shape).query(() => 1);\nexport const label = "adminProcedure";\n',
      "app/trpc/routes/health.ts"
    );

    expect(procedureNames(source).standalone).toEqual(["dbHealth"]);
  });
});

describe("routerKey", () => {
  it("is the key the app router mounts the file under, which need not be the file's name", () => {
    const repo = repoWith({ "app/trpc/routes/tags.ts": "export const tagsRouter = 1;\n" });

    expect(routerKey(repo, "app/trpc/routes/notes.ts")).toBe("notes");
    expect(routerKey(repo, "app/trpc/routes/tags.ts")).toBe("labels");
  });

  it("is undefined for a file the app router does not mount, so its procedures fall back to a match on the name", () => {
    expect(routerKey(repoWith({}), "app/trpc/routes/health.ts")).toBeUndefined();
  });
});

describe("procedureProblems", () => {
  it("asks for the full router-qualified LEVELS key, so the same name under another router does not count", () => {
    const repo = repoWith({ [LEVELS_FILE]: levels("tags.list", "notes.archive"), "app/trpc/routes/__tests__/notes.test.ts": callingTest() });

    const problems = procedureProblems(repo, "app/trpc/routes/notes.ts");

    expect(problems.map((problem) => problem.message)).toEqual(["the procedure `list` has no entry in `LEVELS`"]);
    expect(problems[0]?.fix).toContain('"notes.list"');
  });

  it("reports a test that never calls a procedure on the test file, not on the router", () => {
    const idle = callingTest().replace("await call(appRouter).notes.list()", "[]");
    const repo = repoWith({ [LEVELS_FILE]: levels("notes.list", "notes.archive"), "app/trpc/routes/__tests__/notes.test.ts": idle });

    expect(procedureProblems(repo, "app/trpc/routes/notes.ts")).toMatchObject([{ file: "app/trpc/routes/__tests__/notes.test.ts" }]);
  });

  it("is clean when every procedure is listed and the test calls one through the router", () => {
    const repo = repoWith({ [LEVELS_FILE]: levels("notes.list", "notes.archive"), "app/trpc/routes/__tests__/notes.test.ts": callingTest() });

    expect(procedureProblems(repo, "app/trpc/routes/notes.ts")).toEqual([]);
  });
});
