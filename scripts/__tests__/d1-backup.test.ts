import { describe, it, expect } from "vitest";
import {
  exportArgv,
  gzipArgv,
  isMigrationPending,
  isValidBucketName,
  listArgv,
  objectKey,
  parseBookmark,
  putArgv,
  restoreCommand,
  run,
  shortSha,
  timeTravelInfoArgv,
  utcStamp,
  type CommandResult,
  type Deps,
} from "../ci/d1-backup";

const FAKE_TOKEN = "fake-token-value-for-tests";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const BOOKMARK = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
const NOW = new Date("2026-03-04T05:06:07.890Z");
const KEY = "d1-exports/2026-03-04T05-06-07Z-0123456.sql.gz";
const SUMMARY_FILE = "summary.md";
const TEMP = "/tmp-test";
const DUMP = "/tmp-test/d1-export.sql";
const PACKED = "/tmp-test/d1-export.sql.gz";

const PENDING_OUTPUT = "Migrations to be applied:\n| 0001_init.sql |\n";
const NOTHING_OUTPUT = "✅ No migrations to apply!\n";
const INFO_OUTPUT = `⛅️ wrangler 4.69.0\n${JSON.stringify({ bookmark: BOOKMARK }, null, 2)}\n`;
const ok = (stdout = ""): CommandResult => ({ status: 0, stdout });
const failed: CommandResult = { status: 1, stdout: "" };

type Replies = Partial<Record<"list" | "info" | "export" | "gzip" | "put", CommandResult>>;

function kind(argv: readonly string[]): keyof Replies {
  if (argv[0] === "gzip") return "gzip";
  if (argv.includes("list")) return "list";
  if (argv.includes("info")) return "info";
  if (argv.includes("export")) return "export";
  return "put";
}

function harness(replies: Replies = {}, env: Record<string, string> = {}) {
  const calls: (readonly string[])[] = [];
  const logs: string[] = [];
  const appended: string[] = [];
  const removed: string[] = [];
  const defaults: Required<Replies> = {
    list: ok(PENDING_OUTPUT),
    info: ok(INFO_OUTPUT),
    export: ok(),
    gzip: ok(),
    put: ok(),
  };
  const deps: Deps = {
    env: { CLOUDFLARE_API_TOKEN: FAKE_TOKEN, DEPLOY_SHA: SHA, GITHUB_STEP_SUMMARY: SUMMARY_FILE, ...env },
    runCommand: (argv) => {
      calls.push(argv);
      return { ...defaults, ...replies }[kind(argv)];
    },
    appendFile: (_file, text) => appended.push(text),
    removeFile: (file) => removed.push(file),
    log: (line) => logs.push(line),
    now: () => NOW,
    tempDir: TEMP,
  };
  return { deps, calls, logs, appended, removed, summary: () => appended.join("") };
}

const kinds = (calls: (readonly string[])[]) => calls.map(kind);

describe("isMigrationPending", () => {
  it("reads the wrangler 'nothing to apply' line as not pending, so a clean deploy takes no backup", () => {
    expect(isMigrationPending(NOTHING_OUTPUT)).toBe(false);
  });

  it("treats the pending table and unknown output as pending: when in doubt, take the backup", () => {
    expect(isMigrationPending(PENDING_OUTPUT)).toBe(true);
    expect(isMigrationPending("")).toBe(true);
    expect(isMigrationPending("something new")).toBe(true);
  });
});

describe("parseBookmark", () => {
  it("reads the bookmark from the --json output that follows a banner line", () => {
    expect(parseBookmark(INFO_OUTPUT)).toBe(BOOKMARK);
  });

  it("returns nothing for text, an empty bookmark, a wrong type and a missing key: no restore point means no migration", () => {
    expect(parseBookmark("no json here")).toBeUndefined();
    expect(parseBookmark('{ "bookmark": "" }')).toBeUndefined();
    expect(parseBookmark('{ "bookmark": 5 }')).toBeUndefined();
    expect(parseBookmark('{ "other": "x" }')).toBeUndefined();
    expect(parseBookmark("{ not json }")).toBeUndefined();
    expect(parseBookmark("")).toBeUndefined();
  });
});

describe("isValidBucketName", () => {
  it.each(["abc", "my-backups-1", "a1b", "a".repeat(63)])("accepts %s", (name) => {
    expect(isValidBucketName(name)).toBe(true);
  });

  it.each([
    "ab",
    "a".repeat(64),
    "Upper-case",
    "-leading",
    "trailing-",
    "under_score",
    "dot.name",
    "has space",
    "bucket/with/slash",
    "",
  ])("refuses %j: R2 would reject it or it could change the object path", (name) => {
    expect(isValidBucketName(name)).toBe(false);
  });
});

describe("object key", () => {
  it("formats the UTC time with dashes in the clock part and no milliseconds", () => {
    expect(utcStamp(NOW)).toBe("2026-03-04T05-06-07Z");
  });

  it("builds the key from the clock and the first 7 characters of the commit", () => {
    expect(objectKey(NOW, SHA)).toBe(KEY);
  });

  it("falls back to 'unknown' when the commit is unset, empty or not hex: a stray value must not enter the key", () => {
    for (const sha of [undefined, "", "  ", "not-hex!", "../etc"]) {
      expect(shortSha(sha)).toBe("unknown");
    }
    expect(objectKey(NOW, undefined)).toBe("d1-exports/2026-03-04T05-06-07Z-unknown.sql.gz");
  });
});

describe("argv builders", () => {
  it("passes --remote to list: without it wrangler would read the local database", () => {
    expect(listArgv()).toEqual(["bunx", "wrangler", "d1", "migrations", "list", "DATABASE", "--remote"]);
  });

  it("passes --json to time-travel info: the bookmark parser needs JSON", () => {
    expect(timeTravelInfoArgv()).toEqual(["bunx", "wrangler", "d1", "time-travel", "info", "DATABASE", "--json"]);
  });

  it("passes --remote and --output to export", () => {
    expect(exportArgv(DUMP)).toEqual(["bunx", "wrangler", "d1", "export", "DATABASE", "--remote", "--output", DUMP]);
  });

  it("runs gzip with --force so a leftover .gz from an earlier run cannot stop it", () => {
    expect(gzipArgv(DUMP)).toEqual(["gzip", "--force", DUMP]);
  });

  it("passes --file and --remote to the upload: wrangler 4 writes to local storage without --remote", () => {
    expect(putArgv("my-bucket", KEY, PACKED)).toEqual([
      "bunx", "wrangler", "r2", "object", "put", `my-bucket/${KEY}`, "--file", PACKED, "--remote",
    ]);
  });

  it("prints a restore command that names the bookmark", () => {
    expect(restoreCommand(BOOKMARK)).toBe(
      `bunx wrangler d1 time-travel restore DATABASE --bookmark=${BOOKMARK}`,
    );
  });
});

describe("run", () => {
  it("runs only the list command when no migration is pending: a no-op deploy needs no restore point", () => {
    const h = harness({ list: ok(NOTHING_OUTPUT) }, { D1_BACKUP_BUCKET: "my-bucket" });
    expect(run(h.deps)).toBe(0);
    expect(kinds(h.calls)).toEqual(["list"]);
    expect(h.summary()).toBe("");
  });

  it("exits 1 and runs nothing else when the list call fails: a deploy that cannot check must stop", () => {
    const h = harness({ list: failed }, { D1_BACKUP_BUCKET: "my-bucket" });
    expect(run(h.deps)).toBe(1);
    expect(kinds(h.calls)).toEqual(["list"]);
    expect(h.logs.some((l) => l.startsWith("::error::"))).toBe(true);
  });

  it("records the bookmark and warns, with no export, when no bucket is set", () => {
    const h = harness();
    expect(run(h.deps)).toBe(0);
    expect(kinds(h.calls)).toEqual(["list", "info"]);
    expect(h.logs.some((l) => l.includes(BOOKMARK))).toBe(true);
    const warning = h.logs.find((l) => l.startsWith("::warning::"));
    expect(warning).toContain("D1_BACKUP_BUCKET");
    expect(warning).toContain("docs/ci/rollback.md");
    expect(h.removed).toEqual([]);
  });

  it("treats a blank bucket variable as not set", () => {
    const h = harness({}, { D1_BACKUP_BUCKET: "   " });
    expect(run(h.deps)).toBe(0);
    expect(kinds(h.calls)).toEqual(["list", "info"]);
  });

  it("writes the heading, bookmark, time, commit, restore command and doc link to the step summary", () => {
    const h = harness();
    run(h.deps);
    const text = h.summary();
    expect(text).toContain("Restore point before the migration");
    expect(text).toContain(BOOKMARK);
    expect(text).toContain("2026-03-04T05:06:07.890Z");
    expect(text).toContain(SHA);
    expect(text).toContain(`bunx wrangler d1 time-travel restore DATABASE --bookmark=${BOOKMARK}`);
    expect(text).toContain("docs/ci/rollback.md");
  });

  it("skips the summary file when GITHUB_STEP_SUMMARY is unset, and still logs the bookmark", () => {
    const h = harness({}, { GITHUB_STEP_SUMMARY: "" });
    expect(run(h.deps)).toBe(0);
    expect(h.appended).toEqual([]);
    expect(h.logs.some((l) => l.includes(BOOKMARK))).toBe(true);
  });

  it.each([
    ["a failed call", failed],
    ["output with no bookmark", ok("{}")],
    ["output that is not JSON", ok("oops")],
  ])("exits 1 with no export after %s from time-travel: the restore point comes first", (_name, info) => {
    const h = harness({ info }, { D1_BACKUP_BUCKET: "my-bucket" });
    expect(run(h.deps)).toBe(1);
    expect(kinds(h.calls)).toEqual(["list", "info"]);
    expect(h.logs.some((l) => l.startsWith("::error::") && l.includes("migration will not run"))).toBe(true);
  });

  it("refuses a bad bucket name before any export runs", () => {
    const h = harness({}, { D1_BACKUP_BUCKET: "Bad_Bucket" });
    expect(run(h.deps)).toBe(1);
    expect(kinds(h.calls)).toEqual(["list", "info"]);
    expect(h.logs.some((l) => l.startsWith("::error::"))).toBe(true);
  });

  it("runs list, info, export, gzip and upload in that order, with the exact argv, and removes both files", () => {
    const h = harness({}, { D1_BACKUP_BUCKET: " my-bucket ", RUNNER_TEMP: TEMP });
    expect(run(h.deps)).toBe(0);
    expect(h.calls).toEqual([
      listArgv(),
      timeTravelInfoArgv(),
      exportArgv(DUMP),
      gzipArgv(DUMP),
      putArgv("my-bucket", KEY, PACKED),
    ]);
    expect(h.removed.sort()).toEqual([DUMP, PACKED].sort());
  });

  it("falls back to the OS temp dir when RUNNER_TEMP is unset", () => {
    const h = harness({}, { D1_BACKUP_BUCKET: "my-bucket" });
    run(h.deps);
    expect(h.calls[2]).toEqual(exportArgv(DUMP));
  });

  it("names the object key, the 30-day retention and no bucket name in the summary after an upload", () => {
    const h = harness({}, { D1_BACKUP_BUCKET: "my-bucket" });
    run(h.deps);
    const text = h.summary();
    expect(text).toContain(KEY);
    expect(text).toContain("kept for 30 days by the bucket's lifecycle rule");
    expect(text).not.toContain("my-bucket");
  });

  it("exits 1, uploads nothing and removes both files when the export fails: the dump may be half written", () => {
    const h = harness({ export: failed }, { D1_BACKUP_BUCKET: "my-bucket" });
    expect(run(h.deps)).toBe(1);
    expect(kinds(h.calls)).toEqual(["list", "info", "export"]);
    expect(h.removed.sort()).toEqual([DUMP, PACKED].sort());
    expect(h.logs.some((l) => l.startsWith("::error::") && l.includes("export the database"))).toBe(true);
  });

  it("exits 1, uploads nothing and removes both files when gzip fails", () => {
    const h = harness({ gzip: failed }, { D1_BACKUP_BUCKET: "my-bucket" });
    expect(run(h.deps)).toBe(1);
    expect(kinds(h.calls)).toEqual(["list", "info", "export", "gzip"]);
    expect(h.removed.sort()).toEqual([DUMP, PACKED].sort());
    expect(h.logs.some((l) => l.startsWith("::error::") && l.includes("compress"))).toBe(true);
  });

  it("exits 1 and removes both files when the upload fails: user data must not stay on the runner", () => {
    const h = harness({ put: failed }, { D1_BACKUP_BUCKET: "my-bucket" });
    expect(run(h.deps)).toBe(1);
    expect(kinds(h.calls)).toEqual(["list", "info", "export", "gzip", "put"]);
    expect(h.removed.sort()).toEqual([DUMP, PACKED].sort());
    expect(h.logs.some((l) => l.startsWith("::error::") && l.includes("upload"))).toBe(true);
    expect(h.summary()).not.toContain("kept for");
  });

  it("never passes or logs the API token, and never prints command output", () => {
    const secretOutput = `row data ${FAKE_TOKEN}`;
    const cases = [
      harness({ export: { status: 1, stdout: secretOutput } }, { D1_BACKUP_BUCKET: "my-bucket" }),
      harness({}, { D1_BACKUP_BUCKET: "my-bucket" }),
      harness({}, {}),
    ];
    for (const h of cases) {
      run(h.deps);
      expect(h.calls.flat().join(" ")).not.toContain(FAKE_TOKEN);
      expect(h.logs.join("\n")).not.toContain(FAKE_TOKEN);
      expect(h.summary()).not.toContain(FAKE_TOKEN);
    }
  });
});
