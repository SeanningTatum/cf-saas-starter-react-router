import { describe, expect, it } from "vitest";
import {
  drizzleKitArgs,
  fixApplied,
  fixStatement,
  mergeBaseArgs,
  nameStatusArgs,
  reasonPathFor,
  verifyRefArgs,
} from "../migration-constants";

describe("migration-constants builders", () => {
  it("names the reason file beside its migration: a reason at another path would never clear a finding", () => {
    expect(reasonPathFor("drizzle/0003_drop_old.sql")).toBe("drizzle/0003_drop_old.reason.md");
  });

  it("passes the schema and the out folder to drizzle-kit as separate arguments, sqlite dialect", () => {
    expect(drizzleKitArgs("./app/db/schema.ts", "../tmp/out")).toEqual([
      "generate",
      "--dialect",
      "sqlite",
      "--schema",
      "./app/db/schema.ts",
      "--out",
      "../tmp/out",
    ]);
  });

  it("asks git for a commit behind the ref, so a ref that names nothing is not taken for a base", () => {
    expect(verifyRefArgs("origin/staging")).toEqual(["rev-parse", "--verify", "--quiet", "origin/staging^{commit}"]);
    expect(mergeBaseArgs("origin/staging")).toEqual(["merge-base", "HEAD", "origin/staging"]);
  });

  it("limits the diff to the migrations folder and turns rename detection off: a rename would hide a deleted migration", () => {
    const args = nameStatusArgs("abc123");
    expect(args.slice(0, 4)).toEqual(["diff", "--name-status", "--no-renames", "abc123"]);
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe("drizzle");
  });

  it("tells the author where the reason goes and names the four steps of the rule", () => {
    const line = fixStatement("drizzle/0003_drop_old.reason.md");
    expect(line).toContain("drizzle/0003_drop_old.reason.md");
    expect(line).toContain("add, backfill, switch reads and writes, drop in a later deploy");
    expect(fixApplied("drizzle/0001_x.reason.md")).toContain("put the change in a new migration");
  });
});
