import { describe, it, expect } from "vitest";
import { Either } from "effect";
import {
  buildSql,
  derivePreviewPassword,
  deriveProductionPassword,
  describeMarkdown,
  parseArgs,
  type Target,
} from "../seed-preview";

const SECRET = "a-secret-of-at-least-16-chars";
const LOCAL_PASSWORD = "Password123!";
const PROD_SECRET = "another-secret-16-plus-chars";
const env = { PREVIEW_SEED_SECRET: SECRET, PRODUCTION_SEED_SECRET: PROD_SECRET };
const LOCAL: Target = { flags: ["--local"], label: "local", local: true };
const REMOTE: Target = { flags: ["--remote"], label: "remote", local: false };

const fakeHash = async (password: string) => `hash(${password})`;

function plan(argv: string[], e: Record<string, string | undefined> = env) {
  return parseArgs(argv, e);
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
    expect(derivePreviewPassword(SECRET, "12")).not.toBe(
      derivePreviewPassword(`${SECRET}-2`, "12"),
    );
  });

  it("never equals the local password", () => {
    expect(derivePreviewPassword(SECRET, "12")).not.toBe(LOCAL_PASSWORD);
  });
});

describe("parseArgs targets", () => {
  it("local keeps the in-repo password and needs no secret: dev and the e2e specs depend on it", () => {
    const p = Either.getOrThrow(plan([], {}));
    expect(p).toMatchObject({
      kind: "seed",
      password: LOCAL_PASSWORD,
      target: { local: true, flags: ["--local"] },
    });
  });

  it("--preview uses the derived password for its slug, default 'shared'", () => {
    const withPr = Either.getOrThrow(plan(["--preview", "--pr", "42"]));
    expect(withPr).toMatchObject({ kind: "seed", password: derivePreviewPassword(SECRET, "42") });
    const shared = Either.getOrThrow(plan(["--preview"]));
    expect(shared).toMatchObject({ password: derivePreviewPassword(SECRET, "shared") });
    expect(shared).toMatchObject({
      target: { local: false, flags: ["--env", "preview", "--remote"] },
    });
  });

  it("--remote --force-production derives from PRODUCTION_SEED_SECRET and is not local", () => {
    const p = Either.getOrThrow(plan(["--remote", "--force-production"]));
    expect(p).toMatchObject({
      password: deriveProductionPassword(PROD_SECRET),
      target: { local: false },
    });
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
    for (const argv of [
      ["--preview"],
      ["--preview", "--pr", "1"],
      ["--remote", "--force-production"],
    ]) {
      expect(Either.isLeft(plan(argv, {}))).toBe(true);
      expect(
        Either.isLeft(plan(argv, { PREVIEW_SEED_SECRET: "", PRODUCTION_SEED_SECRET: "" })),
      ).toBe(true);
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

describe("describe output", () => {
  it("has neither the local password nor a derived password: the PR comment of a public repo is public", () => {
    expect(Either.getOrThrow(plan(["--describe"], {}))).toEqual({ kind: "describe" });
    const text = describeMarkdown();
    expect(text).not.toContain(LOCAL_PASSWORD);
    expect(text).not.toContain(derivePreviewPassword(SECRET, "12"));
  });

  it("says where the password comes from and how a maintainer prints it", () => {
    const text = describeMarkdown();
    expect(text).toContain("PREVIEW_SEED_SECRET");
    expect(text).toContain("--print-password --pr");
  });
});

describe("buildSql", () => {
  it("emits UPDATE lines for non-local targets so a rotated secret reaches live previews", async () => {
    const sql = await buildSql("pw", REMOTE, fakeHash, 1);
    const updates = sql.split("\n").filter((l) => l.startsWith("UPDATE account SET password"));
    expect(updates).toEqual([
      "UPDATE account SET password = 'hash(pw)' WHERE id = 'seed-admin-account';",
      "UPDATE account SET password = 'hash(pw)' WHERE id = 'seed-user-account';",
      "UPDATE account SET password = 'hash(pw)' WHERE id = 'seed-banned-account';",
    ]);
  });

  it("emits no UPDATE for local: local stays insert-only and keeps rows a developer edited", async () => {
    const sql = await buildSql("pw", LOCAL, fakeHash, 1);
    expect(sql).not.toContain("UPDATE");
    expect(sql.match(/INSERT OR IGNORE INTO account/g)).toHaveLength(3);
  });

  it("hashes the password it is given and keeps the INSERT OR IGNORE rows", async () => {
    const sql = await buildSql("pw", REMOTE, fakeHash, 1);
    expect(sql.match(/INSERT OR IGNORE INTO user/g)).toHaveLength(3);
    expect(sql).toContain("'hash(pw)'");
    expect(sql).not.toContain(LOCAL_PASSWORD);
  });
});
