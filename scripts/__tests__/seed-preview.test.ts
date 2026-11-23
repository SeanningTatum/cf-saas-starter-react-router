import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Either, Exit, Option } from "effect";
import { getScenario } from "../../app/lib/fixtures/scenarios";
import { SeedError } from "../../app/models/errors/fixture";
import type { RunResult, Shell } from "../lib/shell";
import { buildSeedSql, derivePreviewPassword, deriveProductionPassword, describeFailure, describeMarkdown, parseArgs, seed, type Plan } from "../seed-preview";

const SECRET = "a-secret-of-at-least-16-chars";
const LOCAL_PASSWORD = "Password123!";
const PROD_SECRET = "another-secret-16-plus-chars";
const env = { PREVIEW_SEED_SECRET: SECRET, PRODUCTION_SEED_SECRET: PROD_SECRET };
const SEED_FILE = "/tmp/seed-preview-1/seed.sql";
const PREVIEW_EXECUTE = `bunx wrangler d1 execute DATABASE --env preview --remote --file ${SEED_FILE}`;
const OK: RunResult = { code: 0, stdout: "", stderr: "" };
const BUSY: RunResult = { code: 1, stdout: "", stderr: "D1_ERROR: SQLITE_BUSY: database is locked" };

const PREVIEW_PLAN: Extract<Plan, { kind: "seed" }> = {
  kind: "seed",
  target: { kind: "preview", flags: ["--env", "preview", "--remote"], label: "preview" },
  password: "derived-preview-password",
  scenario: "base",
};

const base = () => Effect.runSync(getScenario("base"));

function plan(argv: string[], e: Record<string, string | undefined> = env) {
  return parseArgs(argv, e);
}

function fakeShell(answers: ReadonlyArray<RunResult> = [OK]) {
  const calls: string[] = [];
  const written: string[] = [];
  let runs = 0;
  const shell: Shell = {
    cwd: "/repo",
    run: (command, args, cwd) => {
      calls.push(`${cwd}: ${command} ${args.join(" ")}`);
      const answer = answers[Math.min(runs, answers.length - 1)] ?? OK;
      runs += 1;
      return answer;
    },
    read: () => undefined,
    write: (path, text) => {
      calls.push(`write ${path}`);
      written.push(text);
    },
    tempDir: (prefix) => `/tmp/${prefix}1`,
    remove: (path) => calls.push(`remove ${path}`),
    out: () => {},
    err: () => {},
  };
  return { shell, calls, written };
}

describe("derivePreviewPassword", () => {
  it("is stable: a push must not change a preview's password", () => {
    expect(derivePreviewPassword(SECRET, "12")).toBe(derivePreviewPassword(SECRET, "12"));
  });

  it("has 24 url-safe characters", () => {
    expect(derivePreviewPassword(SECRET, "12")).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it("differs per slug: one preview's password must not open another", () => {
    expect(derivePreviewPassword(SECRET, "12")).not.toBe(derivePreviewPassword(SECRET, "13"));
  });

  it("differs per secret: rotating the secret must rotate the password", () => {
    expect(derivePreviewPassword(SECRET, "12")).not.toBe(derivePreviewPassword(`${SECRET}-2`, "12"));
  });

  it("never equals the local password", () => {
    expect(derivePreviewPassword(SECRET, "12")).not.toBe(LOCAL_PASSWORD);
  });
});

describe("parseArgs targets", () => {
  it("local keeps the in-repo password and needs no secret: dev and the e2e specs depend on it", () => {
    const p = Either.getOrThrow(plan([], {}));
    expect(p).toMatchObject({ kind: "seed", password: LOCAL_PASSWORD, target: { kind: "local", flags: ["--local"] } });
  });

  it("--preview uses the derived password for its slug, default 'shared'", () => {
    const withPr = Either.getOrThrow(plan(["--preview", "--pr", "42"]));
    expect(withPr).toMatchObject({ kind: "seed", password: derivePreviewPassword(SECRET, "42") });
    const shared = Either.getOrThrow(plan(["--preview"]));
    expect(shared).toMatchObject({ password: derivePreviewPassword(SECRET, "shared") });
    expect(shared).toMatchObject({ target: { kind: "preview", flags: ["--env", "preview", "--remote"] } });
  });

  it("--remote --force-production derives from PRODUCTION_SEED_SECRET and targets remote", () => {
    const p = Either.getOrThrow(plan(["--remote", "--force-production"]));
    expect(p).toMatchObject({ password: deriveProductionPassword(PROD_SECRET), target: { kind: "remote", flags: ["--remote"] } });
  });

  it("the production password differs from every preview password for the same secret value: PR code can read the preview secret", () => {
    const prod = deriveProductionPassword(SECRET);
    for (const slug of ["production", "shared", "1", ""]) {
      expect(prod).not.toBe(derivePreviewPassword(SECRET, slug));
    }
  });

  it("a production seed with only PREVIEW_SEED_SECRET set is refused: the preview secret must never reach production", () => {
    const refused = plan(["--remote", "--force-production"], { PREVIEW_SEED_SECRET: SECRET });
    expect(Either.isLeft(refused)).toBe(true);
    expect(Either.isLeft(refused) && refused.left).toContain("PRODUCTION_SEED_SECRET");
  });

  it("a preview seed ignores PRODUCTION_SEED_SECRET: preview jobs must not need it", () => {
    expect(Either.isLeft(plan(["--preview"], { PRODUCTION_SEED_SECRET: PROD_SECRET }))).toBe(true);
  });

  it("rejects --pr on the production seed: there is one production password", () => {
    expect(Either.isLeft(plan(["--remote", "--force-production", "--pr", "3"]))).toBe(true);
  });

  it("preview and production refuse to run without their secret: the in-repo password must never reach them", () => {
    for (const argv of [["--preview"], ["--preview", "--pr", "1"], ["--remote", "--force-production"]]) {
      expect(Either.isLeft(plan(argv, {}))).toBe(true);
      expect(Either.isLeft(plan(argv, { PREVIEW_SEED_SECRET: "", PRODUCTION_SEED_SECRET: "" }))).toBe(true);
    }
  });

  it("refuses a secret shorter than 16 characters: a guessable secret makes the derived password guessable", () => {
    const short = plan(["--preview"], { PREVIEW_SEED_SECRET: "x".repeat(15) });
    expect(Either.isLeft(short)).toBe(true);
    expect(Either.isRight(plan(["--preview"], { PREVIEW_SEED_SECRET: "x".repeat(16) }))).toBe(true);
  });

  it("refuses --remote without --force-production, with or without the secret", () => {
    expect(Either.isLeft(plan(["--remote"]))).toBe(true);
    expect(Either.isLeft(plan(["--remote"], {}))).toBe(true);
  });

  it("refuses --preview with --remote", () => {
    expect(Either.isLeft(plan(["--preview", "--remote", "--force-production"]))).toBe(true);
  });

  it("rejects a bad slug: it ends up in a message that is hashed, and in log lines", () => {
    expect(Either.isLeft(plan(["--preview", "--pr", "a b"]))).toBe(true);
    expect(Either.isLeft(plan(["--preview", "--pr"]))).toBe(true);
    expect(Either.isLeft(plan(["--preview", "--pr", "--remote"]))).toBe(true);
  });

  it("rejects --pr on a local seed: it would silently do nothing", () => {
    expect(Either.isLeft(plan(["--pr", "3"], {}))).toBe(true);
  });
});

describe("parseArgs --scenario", () => {
  it("defaults to base, so a bare db:seed still gives the three login accounts", () => {
    expect(Either.getOrThrow(plan([], {}))).toMatchObject({ kind: "seed", scenario: "base" });
    expect(Either.getOrThrow(plan(["--describe"], {}))).toEqual({ kind: "describe", scenario: "base" });
  });

  it("carries many-users to the local and the preview seed", () => {
    expect(Either.getOrThrow(plan(["--scenario", "many-users"], {}))).toMatchObject({ scenario: "many-users", target: { kind: "local" } });
    expect(Either.getOrThrow(plan(["--preview", "--scenario", "many-users"]))).toMatchObject({
      scenario: "many-users",
      target: { kind: "preview" },
    });
  });

  it("refuses an unknown or missing name and lists the valid ones, so a typo never seeds the wrong data", () => {
    for (const argv of [["--scenario", "lots"], ["--scenario"], ["--preview", "--scenario", "Base"]]) {
      const refused = plan(argv);
      expect(Either.isLeft(refused) && refused.left).toContain("base, empty, many-users");
    }
  });
});

describe("parseArgs --print-password", () => {
  it("prints the derived password for the slug and nothing else", () => {
    expect(Either.getOrThrow(plan(["--print-password", "--pr", "7"]))).toEqual({
      kind: "print-password",
      password: derivePreviewPassword(SECRET, "7"),
    });
  });

  it("needs --pr and the secret", () => {
    expect(Either.isLeft(plan(["--print-password"]))).toBe(true);
    expect(Either.isLeft(plan(["--print-password", "--pr", "7"], {}))).toBe(true);
  });
});

describe("describeMarkdown", () => {
  it("has neither the local password nor a derived password: the PR comment of a public repo is public", () => {
    const text = describeMarkdown(base());
    expect(text).not.toContain(LOCAL_PASSWORD);
    expect(text).not.toContain(derivePreviewPassword(SECRET, "12"));
  });

  it("says where the password comes from and how a maintainer prints it", () => {
    const text = describeMarkdown(base());
    expect(text).toContain("PREVIEW_SEED_SECRET");
    expect(text).toContain("--print-password --pr");
  });

  it("lists only the login accounts, so many-users does not post 50 rows into the PR comment", () => {
    const text = describeMarkdown(Effect.runSync(getScenario("many-users")));
    for (const email of ["admin@preview.local", "user@preview.local", "banned@preview.local"]) expect(text).toContain(email);
    expect(text).not.toContain("user-001@preview.local");
  });
});

describe("buildSeedSql", () => {
  it("deletes the seed-% rows and inserts plainly with the given hash, so a restore resets edited rows and a rotated secret lands", () => {
    const sql = buildSeedSql(base(), "hash(pw)");
    expect(sql).toContain("DELETE FROM user WHERE id LIKE 'seed-%';");
    expect(sql).toContain("'hash(pw)'");
    expect(sql.match(/^INSERT INTO account/gm)).toHaveLength(3);
    expect(sql).not.toContain("INSERT OR IGNORE");
    expect(sql).not.toMatch(/\bUPDATE\s/);
    expect(sql).not.toContain(LOCAL_PASSWORD);
  });
});

describe("seed", () => {
  it.effect("writes one file, runs it in one wrangler call, removes the temp dir and stores a hash, never the password", () =>
    Effect.gen(function* () {
      const { shell, calls, written } = fakeShell();
      const scenario = yield* seed(PREVIEW_PLAN, shell);
      expect(scenario.name).toBe("base");
      expect(calls).toEqual([`write ${SEED_FILE}`, `/repo: ${PREVIEW_EXECUTE}`, "remove /tmp/seed-preview-1"]);
      expect(written).toHaveLength(1);
      expect(written[0]).toContain("DELETE FROM session WHERE user_id LIKE 'seed-%';");
      expect(written[0]).not.toContain(PREVIEW_PLAN.password);
    }),
  );

  it.effect("fails with a SeedError naming the target, does not retry a plain failure, and still removes the temp dir", () =>
    Effect.gen(function* () {
      const { shell, calls } = fakeShell([{ code: 1, stdout: "", stderr: "Authentication error" }]);
      const exit = yield* Effect.exit(seed(PREVIEW_PLAN, shell));
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(failure) && failure.value).toBeInstanceOf(SeedError);
      expect(Option.map(failure, (e) => (e instanceof SeedError ? e.target : ""))).toEqual(Option.some("preview"));
      expect(Option.map(failure, describeFailure).pipe(Option.getOrElse(() => ""))).toContain("Failed to seed the preview D1");
      expect(calls.filter((line) => line.includes("wrangler"))).toHaveLength(1);
      expect(calls.at(-1)).toBe("remove /tmp/seed-preview-1");
    }),
  );

  it.live("retries SQLITE_BUSY and succeeds once the database frees up", () =>
    Effect.gen(function* () {
      const { shell, calls } = fakeShell([BUSY, BUSY, OK]);
      yield* seed(PREVIEW_PLAN, shell);
      expect(calls.filter((line) => line.includes("wrangler"))).toHaveLength(3);
    }),
  );

  it.live("gives up after three SQLITE_BUSY retries with a SeedError and removes the temp dir once", () =>
    Effect.gen(function* () {
      const { shell, calls } = fakeShell([BUSY]);
      const exit = yield* Effect.exit(seed(PREVIEW_PLAN, shell));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls.filter((line) => line.includes("wrangler"))).toHaveLength(4);
      expect(calls.filter((line) => line.startsWith("remove"))).toEqual(["remove /tmp/seed-preview-1"]);
    }),
  );
});
