import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyStatement,
  decideDrift,
  generateInTempCopy,
  parseNameStatus,
  reasonState,
  resolveBaseRef,
  run,
  scanSql,
  splitStatements,
  type Deps,
  type DriftProbe,
  type GitResult,
} from "../migration-check";
import {
  DEFAULT_SCHEMA_PATH,
  DRIZZLE_DIR,
  MIN_REASON_CHARS,
} from "../lib/migration-constants";

const repoRoot = path.join(__dirname, "..", "..");
const FILE = "drizzle/0001_x.sql";
const kinds = (sql: string) => scanSql(FILE, sql).map((f) => f.kind);
const LONG_REASON = "Safe: the live code no longer reads this column at all.";

describe("statement scanner", () => {
  it("flags DROP TABLE so a destructive drop needs a reason", () => {
    expect(kinds("DROP TABLE `old`;")).toEqual(["drop"]);
  });
  it("flags DROP INDEX, VIEW and TRIGGER too", () => {
    expect(kinds("DROP INDEX i;\nDROP VIEW v;\nDROP TRIGGER t;")).toEqual(["drop", "drop", "drop"]);
  });
  it("flags ALTER TABLE DROP COLUMN and the short DROP form", () => {
    expect(kinds("ALTER TABLE `t` DROP COLUMN `c`;\nALTER TABLE t DROP c;")).toEqual(["drop", "drop"]);
  });
  it("flags RENAME TO and RENAME COLUMN as renames", () => {
    expect(kinds("ALTER TABLE a RENAME TO b;\nALTER TABLE a RENAME COLUMN x TO y;")).toEqual([
      "rename",
      "rename",
    ]);
  });
  it("flags ADD COLUMN NOT NULL with no DEFAULT", () => {
    expect(kinds("ALTER TABLE `t` ADD `c` text NOT NULL;")).toEqual(["not-null-no-default"]);
    expect(kinds("ALTER TABLE t ADD COLUMN c integer NOT NULL;")).toEqual(["not-null-no-default"]);
  });
  it("passes ADD COLUMN NOT NULL DEFAULT, which cannot break old rows", () => {
    expect(kinds("ALTER TABLE t ADD c text NOT NULL DEFAULT 'x';")).toEqual([]);
  });
  it("passes ADD COLUMN that allows null", () => {
    expect(kinds("ALTER TABLE t ADD c text;")).toEqual([]);
  });
  it("does not flag NOT NULL columns in a new CREATE TABLE", () => {
    expect(kinds("CREATE TABLE t (id text NOT NULL, n integer NOT NULL);")).toEqual([]);
  });
  it("matches lower-case SQL", () => {
    expect(
      kinds("drop table t;\nalter table t rename to u;\nalter table t add c text not null;"),
    ).toEqual(["drop", "rename", "not-null-no-default"]);
  });
  it("ignores a column named drop_reason", () => {
    expect(kinds("CREATE TABLE t (drop_reason text, `drop` text);")).toEqual([]);
  });
  it("ignores a table named rename_log in quotes and brackets", () => {
    expect(
      kinds("CREATE TABLE `rename_log` (id text);\nCREATE INDEX [drop me] ON `rename_log` (id);"),
    ).toEqual([]);
  });
  it("ignores DROP inside a string default", () => {
    expect(kinds("ALTER TABLE t ADD c text DEFAULT 'DROP TABLE x';")).toEqual([]);
  });
  it("ignores a semicolon inside a quoted string", () => {
    expect(kinds("INSERT INTO t VALUES ('a; DROP TABLE x');")).toEqual([]);
  });
  it("ignores statements hidden in -- and block comments", () => {
    expect(
      kinds("-- DROP TABLE t;\n/* ALTER TABLE t RENAME TO u; */\nCREATE TABLE z (id text);"),
    ).toEqual([]);
  });
  it("reads past the Drizzle statement-breakpoint marker", () => {
    expect(kinds("CREATE TABLE a (id text);\n--> statement-breakpoint\nDROP TABLE b;")).toEqual([
      "drop",
    ]);
  });
  it("flags the Drizzle SQLite table rebuild through its DROP and RENAME", () => {
    const rebuild = [
      "CREATE TABLE `__new_x` (`id` text PRIMARY KEY NOT NULL);",
      "--> statement-breakpoint",
      "INSERT INTO `__new_x`(`id`) SELECT `id` FROM `x`;",
      "--> statement-breakpoint",
      "DROP TABLE `x`;",
      "--> statement-breakpoint",
      "ALTER TABLE `__new_x` RENAME TO `x`;",
    ].join("\n");
    expect(kinds(rebuild)).toEqual(["drop", "rename"]);
  });
  it("keeps the quoted name in the detail so the report names the table", () => {
    expect(scanSql(FILE, "DROP TABLE `old_users`;")[0]?.detail).toBe("DROP TABLE `old_users`");
  });
  it("ends an unterminated quote at the end of the file instead of looping", () => {
    expect(splitStatements("SELECT 'oops")).toHaveLength(1);
    expect(classifyStatement("SELECT 1")).toBeUndefined();
  });
});

describe("reason rule", () => {
  it("treats a missing reason file as no reason", () => {
    expect(reasonState(undefined)).toBe("missing");
  });
  it("rejects a reason shorter than the minimum", () => {
    expect(reasonState("ok fine")).toBe("short");
  });
  it("does not count whitespace toward the minimum", () => {
    expect(reasonState(`${"a".repeat(MIN_REASON_CHARS - 1)}${" \n\t".repeat(50)}`)).toBe("short");
  });
  it("accepts a reason of exactly the minimum", () => {
    expect(reasonState("a".repeat(MIN_REASON_CHARS))).toBe("ok");
  });
});

describe("name-status parser", () => {
  it("keeps modified and deleted top-level migrations", () => {
    const text = "M\tdrizzle/0000_init.sql\nD\tdrizzle/0001_a.sql\n";
    expect(parseNameStatus(text).map((f) => [f.file, f.kind])).toEqual([
      ["drizzle/0000_init.sql", "edited"],
      ["drizzle/0001_a.sql", "deleted"],
    ]);
  });
  it("ignores added files, since a new migration is allowed", () => {
    expect(parseNameStatus("A\tdrizzle/0002_new.sql\n")).toEqual([]);
  });
  it("ignores the meta folder, whose snapshot changes with every migration", () => {
    expect(parseNameStatus("M\tdrizzle/meta/_journal.json\nM\tdrizzle/meta/0000.sql\n")).toEqual([]);
  });
  it("ignores non-sql files such as reason notes", () => {
    expect(parseNameStatus("M\tdrizzle/0001_a.reason.md\nD\tdrizzle/notes.txt\n")).toEqual([]);
  });
  it("copes with empty output and blank lines", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus("\n\n")).toEqual([]);
  });
});

interface GitScript {
  symbolic?: string;
  valid?: string[];
  mergeBase?: string;
  diff?: GitResult;
}

function fakeGit(script: GitScript, calls: string[][] = []) {
  return (argv: string[]): GitResult => {
    calls.push(argv);
    const verb = argv[0];
    if (verb === "symbolic-ref") {
      return script.symbolic === undefined
        ? { status: 1, stdout: "" }
        : { status: 0, stdout: `${script.symbolic}\n` };
    }
    if (verb === "rev-parse") {
      const ref = (argv[argv.length - 1] ?? "").replace("^{commit}", "");
      return { status: (script.valid ?? []).includes(ref) ? 0 : 1, stdout: "" };
    }
    if (verb === "merge-base") {
      return script.mergeBase === undefined
        ? { status: 1, stdout: "" }
        : { status: 0, stdout: `${script.mergeBase}\n` };
    }
    return script.diff ?? { status: 0, stdout: "" };
  };
}

describe("base ref resolution", () => {
  it("prefers GITHUB_BASE_REF over origin/HEAD", () => {
    const git = fakeGit({ symbolic: "origin/main", valid: ["origin/release", "origin/main"] });
    expect(resolveBaseRef({ env: { GITHUB_BASE_REF: "release" }, git })).toBe("origin/release");
  });
  it("uses origin/HEAD when GITHUB_BASE_REF is empty", () => {
    const git = fakeGit({ symbolic: "origin/main", valid: ["origin/main"] });
    expect(resolveBaseRef({ env: { GITHUB_BASE_REF: "" }, git })).toBe("origin/main");
  });
  it("falls back to origin/HEAD when the named branch is not fetched", () => {
    const git = fakeGit({ symbolic: "origin/main", valid: ["origin/main"] });
    expect(resolveBaseRef({ env: { GITHUB_BASE_REF: "gone" }, git })).toBe("origin/main");
  });
  it("returns nothing in a fresh fork with no remote", () => {
    expect(resolveBaseRef({ env: {}, git: fakeGit({}) })).toBeUndefined();
  });
  it("returns nothing when origin/HEAD names a ref with no commit", () => {
    const git = fakeGit({ symbolic: "origin/main", valid: [] });
    expect(resolveBaseRef({ env: {}, git })).toBeUndefined();
  });
});

describe("drift decision table", () => {
  const sqlFile = { name: "0001_new.sql", sql: "CREATE TABLE x (id text);" };
  it("reports drift when drizzle-kit wrote a new file", () => {
    expect(decideDrift({ newFiles: [sqlFile], output: "" })).toEqual({
      kind: "drift",
      files: [sqlFile],
    });
  });
  it("lets a new file win over a stray No schema changes line", () => {
    expect(decideDrift({ newFiles: [sqlFile], output: "No schema changes" }).kind).toBe("drift");
  });
  it("is clean when there is no new file and drizzle-kit says No schema changes", () => {
    const probe = { newFiles: [], output: "[✓] No schema changes, nothing to migrate" };
    expect(decideDrift(probe).kind).toBe("clean");
  });
  it("fails when drizzle-kit errors but exits 0 with no file and no clean message", () => {
    expect(decideDrift({ newFiles: [], output: "Error: cannot find schema" })).toEqual({
      kind: "unclear",
      output: "Error: cannot find schema",
    });
  });
  it("fails on empty output", () => {
    expect(decideDrift({ newFiles: [], output: "" }).kind).toBe("unclear");
  });
});

interface World {
  files?: Record<string, string>;
  git?: GitScript;
  env?: Record<string, string>;
  probe?: DriftProbe;
}

const CLEAN: DriftProbe = { newFiles: [], output: "No schema changes" };
const SQL_AT_TOP = /^drizzle\/[^/]+\.sql$/;

function harness(world: World) {
  const files = world.files ?? {};
  const out: string[] = [];
  const deps: Deps = {
    env: world.env ?? {},
    schemaPath: "./schema.ts",
    listSql: () =>
      Object.keys(files)
        .filter((f) => SQL_AT_TOP.test(f))
        .map((f) => f.slice(DRIZZLE_DIR.length + 1))
        .sort(),
    readFile: (f) => files[f],
    git: fakeGit(world.git ?? {}),
    drift: () => world.probe ?? CLEAN,
    log: (line) => out.push(line),
  };
  return { deps, out };
}

const DROP_FILES = { "drizzle/0001_x.sql": "DROP TABLE t;" };
const ON_MAIN: GitScript = { symbolic: "origin/main", valid: ["origin/main"] };

describe("run exit codes", () => {
  it("passes a repo with safe migrations, no base ref and no drift", () => {
    const { deps, out } = harness({
      files: { "drizzle/0000_init.sql": "CREATE TABLE a (id text);" },
    });
    expect(run(deps)).toBe(0);
    expect(out.some((l) => l.includes("skipped") && l.includes("no base ref"))).toBe(true);
    expect(out[out.length - 1]).toContain("1 checked");
  });
  it("fails a DROP with no reason file and tells the author how to fix it", () => {
    const { deps, out } = harness({ files: DROP_FILES });
    expect(run(deps)).toBe(1);
    expect(out[0]).toBe("✗ drizzle/0001_x.sql: drop: DROP TABLE t");
    expect(out[1]).toContain("drizzle/0001_x.reason.md");
    expect(out[1]).toContain("docs/ci/rollback.md");
  });
  it("fails a DROP whose reason is too short", () => {
    const { deps } = harness({ files: { ...DROP_FILES, "drizzle/0001_x.reason.md": "because" } });
    expect(run(deps)).toBe(1);
  });
  it("passes a DROP with a long reason and prints the reason path", () => {
    const { deps, out } = harness({
      files: { ...DROP_FILES, "drizzle/0001_x.reason.md": LONG_REASON },
    });
    expect(run(deps)).toBe(0);
    expect(out[0]).toBe(
      "✓ drizzle/0001_x.sql: drop: DROP TABLE t (reason: drizzle/0001_x.reason.md)",
    );
  });
  it("lets one reason file cover every finding on its migration", () => {
    const files = {
      "drizzle/0001_x.sql": "DROP TABLE t;\nALTER TABLE a RENAME TO b;",
      "drizzle/0001_x.reason.md": LONG_REASON,
    };
    const { deps, out } = harness({ files });
    expect(run(deps)).toBe(0);
    expect(out.filter((l) => l.includes("(reason:"))).toHaveLength(2);
  });
  it("fails an edited migration that exists on the base", () => {
    const { deps, out } = harness({
      files: { "drizzle/0000_init.sql": "CREATE TABLE a (id text);" },
      git: { ...ON_MAIN, mergeBase: "abc123", diff: { status: 0, stdout: "M\tdrizzle/0000_init.sql\n" } },
    });
    expect(run(deps)).toBe(1);
    expect(out[0]).toContain("✗ drizzle/0000_init.sql: edited:");
  });
  it("fails a deleted migration and accepts a reason at the same path", () => {
    const git: GitScript = { ...ON_MAIN, diff: { status: 0, stdout: "D\tdrizzle/0001_gone.sql\n" } };
    const bad = harness({ git });
    expect(run(bad.deps)).toBe(1);
    expect(bad.out[0]).toContain("deleted");
    const good = harness({ git, files: { "drizzle/0001_gone.reason.md": LONG_REASON } });
    expect(run(good.deps)).toBe(0);
  });
  it("diffs against the merge base, and against the ref itself when merge-base fails", () => {
    const { deps } = harness({});
    const withBase: string[][] = [];
    deps.git = fakeGit({ ...ON_MAIN, mergeBase: "abc123" }, withBase);
    run(deps);
    expect(withBase.find((c) => c[0] === "diff")).toContain("abc123");
    const withoutBase: string[][] = [];
    deps.git = fakeGit(ON_MAIN, withoutBase);
    run(deps);
    expect(withoutBase.find((c) => c[0] === "diff")).toContain("origin/main");
  });
  it("fails when git diff itself fails, so a broken check is not read as a pass", () => {
    const { deps } = harness({ git: { ...ON_MAIN, diff: { status: 128, stdout: "" } } });
    expect(run(deps)).toBe(1);
  });
  it("fails on drift, prints the new SQL, and offers no reason escape", () => {
    const { deps, out } = harness({
      files: { "drizzle/0001_x.reason.md": LONG_REASON },
      probe: {
        newFiles: [{ name: "0001_new.sql", sql: "CREATE TABLE `fresh` (id text);" }],
        output: "",
      },
    });
    expect(run(deps)).toBe(1);
    expect(out.join("\n")).toContain("CREATE TABLE `fresh`");
    expect(out.join("\n")).toContain("bun run db:generate");
  });
  it("fails and prints the output when drizzle-kit gives no clear answer", () => {
    const { deps, out } = harness({ probe: { newFiles: [], output: "boom happened" } });
    expect(run(deps)).toBe(1);
    expect(out.join("\n")).toContain("boom happened");
  });
});

const CONFIG_OUT_PATTERN = /out:\s*"([^"]+)"/;
const CONFIG_SCHEMA_PATTERN = /schema:\s*"([^"]+)"/;

describe("drizzle.config.ts match", () => {
  const text = fs.readFileSync(path.join(repoRoot, "drizzle.config.ts"), "utf-8");
  it("keeps the default schema path equal to the one drizzle.config.ts names", () => {
    expect(CONFIG_SCHEMA_PATTERN.exec(text)?.[1]).toBe(DEFAULT_SCHEMA_PATH);
  });
  it("keeps the default out dir equal to the one drizzle.config.ts names", () => {
    const out = CONFIG_OUT_PATTERN.exec(text)?.[1] ?? "";
    expect(path.normalize(out)).toBe(DRIZZLE_DIR);
  });
});

const ownTempRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "migration-check-test-root-"));
const migrationsListing = () => fs.readdirSync(path.join(repoRoot, DRIZZLE_DIR)).sort();
const SLOW_TEST_MS = 30000;

describe("drift against real drizzle-kit", () => {
  it(
    "reports one extra table as drift and leaves nothing in its own temp root and no new migration (it once counted folders in the shared OS temp folder, so a second checkout's run could fail it)",
    () => {
      const tempRoot = ownTempRoot();
      const listing = migrationsListing();
      const schema = "./scripts/__tests__/fixtures/migration-check/schema-extra.ts";
      const verdict = decideDrift(generateInTempCopy(repoRoot, schema, tempRoot));
      const leftInTempRoot = fs.readdirSync(tempRoot);
      fs.rmSync(tempRoot, { recursive: true, force: true });
      expect(verdict.kind).toBe("drift");
      if (verdict.kind === "drift") expect(verdict.files[0]?.sql).toContain("drift_probe");
      expect(leftInTempRoot).toEqual([]);
      expect(migrationsListing()).toEqual(listing);
    },
    SLOW_TEST_MS,
  );

  it("returns an unclear probe, not a throw, when the repo has no drizzle folder", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "empty-root-"));
    const tempRoot = ownTempRoot();
    const probe = generateInTempCopy(empty, DEFAULT_SCHEMA_PATH, tempRoot);
    const leftInTempRoot = fs.readdirSync(tempRoot);
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
    expect(leftInTempRoot).toEqual([]);
    expect(probe.newFiles).toEqual([]);
    expect(probe.output).not.toBe("");
    expect(decideDrift(probe).kind).toBe("unclear");
  });
});
