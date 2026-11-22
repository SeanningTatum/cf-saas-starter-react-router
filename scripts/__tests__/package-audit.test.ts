import { describe, it, expect } from "vitest";
import { Either } from "effect";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOW_FILE,
  advisoryId,
  judge,
  parseAllow,
  parseAudit,
  run,
  type AllowEntry,
  type Deps,
  type Finding,
} from "../package-audit";

const TODAY = "2026-11-22";
const finding = (over: Partial<Finding> = {}): Finding => ({
  package: "left-pad",
  severity: "high",
  id: "GHSA-aaaa-bbbb-cccc",
  title: "Prototype pollution",
  ...over,
});
const entry = (over: Partial<AllowEntry> = {}): AllowEntry => ({
  id: "GHSA-aaaa-bbbb-cccc",
  package: "left-pad",
  reason: "test",
  expires: "2030-01-01",
  ...over,
});

/** The shape bun audit --json prints. */
function auditJson(
  items: { pkg: string; severity: string; ghsa: string; title?: string }[],
): string {
  const out: Record<string, unknown[]> = {};
  for (const i of items) {
    const list = out[i.pkg] ?? [];
    out[i.pkg] = list;
    list.push({
      id: 1000,
      url: `https://github.com/advisories/${i.ghsa}`,
      title: i.title ?? "A title",
      severity: i.severity,
      vulnerable_versions: "<1.0.0",
      cwe: ["CWE-1"],
    });
  }
  return JSON.stringify(out);
}

describe("advisoryId", () => {
  it("takes the GHSA from the url, because the numeric id differs between registries", () => {
    expect(advisoryId("https://github.com/advisories/GHSA-4x5r-pxfx-6jf8")).toBe(
      "GHSA-4x5r-pxfx-6jf8",
    );
  });
  it("falls back to the url when there is no GHSA, so a finding is never silently unnamed", () => {
    expect(advisoryId("https://example.test/a/1")).toBe("https://example.test/a/1");
  });
});

describe("parseAudit", () => {
  it("reads the bun audit --json shape and ignores fields it does not use", () => {
    const parsed = parseAudit(
      auditJson([{ pkg: "a", severity: "high", ghsa: "GHSA-1111-2222-3333", title: "T" }]),
    );
    expect(parsed).toEqual(
      Either.right([{ package: "a", severity: "high", id: "GHSA-1111-2222-3333", title: "T" }]),
    );
  });
  it("an empty object is a clean audit, not an error", () => {
    expect(parseAudit("{}")).toEqual(Either.right([]));
  });
  it.each([
    ["empty stdout", ""],
    ["plain text", "error: registry unreachable"],
    ["an array", "[]"],
    ["wrong value type", '{"a":1}'],
  ])("%s is left, so an audit that did not run cannot pass", (_name, stdout) => {
    expect(Either.isLeft(parseAudit(stdout))).toBe(true);
  });
});

describe("parseAllow", () => {
  it("decodes a well-formed file", () => {
    expect(parseAllow(JSON.stringify({ allow: [entry()] }))).toEqual(Either.right([entry()]));
  });
  it.each([
    ["bad json", "{"],
    ["no allow key", "{}"],
    ["entry without a reason", '{"allow":[{"id":"x","package":"y"}]}'],
    ["empty reason", '{"allow":[{"id":"x","package":"y","reason":""}]}'],
  ])(
    "%s is left: a typo in the file must not silently allow nothing or everything",
    (_name, text) => {
      expect(Either.isLeft(parseAllow(text))).toBe(true);
    },
  );
});

describe("judge", () => {
  it("only high and critical count: a moderate finding must not block", () => {
    const v = judge([finding({ severity: "low" }), finding({ severity: "moderate" })], [], TODAY);
    expect(v).toEqual({ blocking: [], allowed: [], expired: [], stale: [] });
  });
  it("high and critical both block", () => {
    const v = judge(
      [finding(), finding({ severity: "critical", id: "GHSA-dddd-eeee-ffff" })],
      [],
      TODAY,
    );
    expect(v.blocking).toHaveLength(2);
  });
  it("an allowed id and package pair does not block", () => {
    const v = judge([finding()], [entry()], TODAY);
    expect(v).toEqual({ blocking: [], allowed: [finding()], expired: [], stale: [] });
  });
  it("the same GHSA in a different package still blocks: the entry names a pair", () => {
    const v = judge([finding({ package: "other" })], [entry()], TODAY);
    expect(v.blocking).toEqual([finding({ package: "other" })]);
    expect(v.stale).toEqual([entry()]);
  });
  it("a different GHSA in an allowed package still blocks", () => {
    const v = judge([finding({ id: "GHSA-zzzz-zzzz-zzzz" })], [entry()], TODAY);
    expect(v.blocking).toHaveLength(1);
  });
  it("an expired entry stops allowing and is listed as expired", () => {
    const old = entry({ expires: "2026-11-21" });
    const v = judge([finding()], [old], TODAY);
    expect(v.blocking).toEqual([finding()]);
    expect(v.expired).toEqual([old]);
    expect(v.stale).toEqual([]);
  });
  it("severity compares without case and an unknown word blocks", () => {
    expect(judge([finding({ severity: "Critical" })], [], TODAY).blocking).toHaveLength(1);
    expect(judge([finding({ severity: "weird" })], [], TODAY).blocking).toHaveLength(1);
    expect(judge([finding({ severity: "MODERATE" })], [], TODAY).blocking).toEqual([]);
  });
  it("an entry nothing reports is stale", () => {
    expect(judge([], [entry()], TODAY).stale).toEqual([entry()]);
  });
  it("an entry whose finding fell to moderate is stale too", () => {
    expect(judge([finding({ severity: "moderate" })], [entry()], TODAY).stale).toEqual([entry()]);
  });
});

describe("run", () => {
  function depsFor(opts: { stdout: string; stderr?: string; status?: number; allow?: string }): {
    deps: Deps;
    lines: string[];
  } {
    const lines: string[] = [];
    const deps: Deps = {
      audit: () => ({ stdout: opts.stdout, stderr: opts.stderr ?? "", status: opts.status ?? 0 }),
      today: () => TODAY,
      readAllow: () => opts.allow,
      log: (line) => lines.push(line),
    };
    return { deps, lines };
  }
  const high = auditJson([
    {
      pkg: "left-pad",
      severity: "high",
      ghsa: "GHSA-aaaa-bbbb-cccc",
      title: "Prototype pollution",
    },
  ]);

  it("a blocking finding exits 1 with one blocking line and the fix", () => {
    const { deps, lines } = depsFor({ stdout: high });
    expect(run(deps)).toBe(1);
    expect(lines[0]).toBe("blocking: left-pad high GHSA-aaaa-bbbb-cccc Prototype pollution");
    expect(lines[1]).toContain("bun update <package>");
    expect(lines[1]).toContain(ALLOW_FILE);
  });

  it("an allowed finding exits 0 and prints the allowed count as a notice", () => {
    const { deps, lines } = depsFor({ stdout: high, allow: JSON.stringify({ allow: [entry()] }) });
    expect(run(deps)).toBe(0);
    expect(lines).toEqual([
      `notice: 1 known high or critical findings are allowed in ${ALLOW_FILE}`,
      "ok: no new high or critical findings",
    ]);
  });

  it("a stale entry is a notice with exit 0: upgrading a package must not break the gate", () => {
    const { deps, lines } = depsFor({ stdout: "{}", allow: JSON.stringify({ allow: [entry()] }) });
    expect(run(deps)).toBe(0);
    expect(lines[0]).toMatch(
      /^notice: GHSA-aaaa-bbbb-cccc in left-pad is no longer reported; delete/,
    );
    expect(lines.at(-1)).toBe("ok: no new high or critical findings");
  });

  it("a clean audit with no allow file prints ok and exits 0", () => {
    const { deps, lines } = depsFor({ stdout: "{}" });
    expect(run(deps)).toBe(0);
    expect(lines).toEqual(["ok: no new high or critical findings"]);
  });

  it("empty stdout is an error that quotes stderr and exits 1", () => {
    const { deps, lines } = depsFor({ stdout: "", stderr: "\nerror: getaddrinfo ENOTFOUND\nmore" });
    expect(run(deps)).toBe(1);
    expect(lines).toEqual(["error: the audit could not run: error: getaddrinfo ENOTFOUND"]);
  });

  it("non-JSON stdout is an error that quotes its first line and exits 1", () => {
    const { deps, lines } = depsFor({ stdout: "unknown flag --json\nusage..." });
    expect(run(deps)).toBe(1);
    expect(lines).toEqual(["error: the audit could not run: unknown flag --json"]);
  });

  it("an expired entry blocks and the line says the allowance expired", () => {
    const { deps, lines } = depsFor({
      stdout: high,
      allow: JSON.stringify({ allow: [entry({ expires: "2026-11-21" })] }),
    });
    expect(run(deps)).toBe(1);
    expect(lines[0]).toBe(
      "blocking: left-pad high GHSA-aaaa-bbbb-cccc Prototype pollution (allowance expired 2026-11-21)",
    );
  });

  it("an entry that expires today still allows: the date is the last day", () => {
    const { deps } = depsFor({
      stdout: high,
      allow: JSON.stringify({ allow: [entry({ expires: TODAY })] }),
    });
    expect(run(deps)).toBe(0);
  });

  it.each([
    ["missing", `{"allow":[{"id":"x","package":"y","reason":"z"}]}`],
    ["not a date", `{"allow":[{"id":"x","package":"y","reason":"z","expires":"soon"}]}`],
    [
      "an impossible date",
      `{"allow":[{"id":"x","package":"y","reason":"z","expires":"2026-13-45"}]}`,
    ],
    [
      "a day that month does not have",
      `{"allow":[{"id":"x","package":"y","reason":"z","expires":"2026-02-30"}]}`,
    ],
  ])(
    "an expires that is %s is a config error, so no entry can allow forever by accident",
    (_name, allow) => {
      const { deps, lines } = depsFor({ stdout: "{}", allow });
      expect(run(deps)).toBe(1);
      expect(lines[0]).toMatch(/^error: .*malformed/);
    },
  );

  it("a severity in capitals still blocks", () => {
    const { deps, lines } = depsFor({
      stdout: auditJson([{ pkg: "a", severity: "HIGH", ghsa: "GHSA-1111-2222-3333" }]),
    });
    expect(run(deps)).toBe(1);
    expect(lines[0]).toContain("blocking: a HIGH");
  });

  it("a severity bun adds later blocks: an unknown word must not read as harmless", () => {
    const { deps } = depsFor({
      stdout: auditJson([{ pkg: "a", severity: "severe", ghsa: "GHSA-1111-2222-3333" }]),
    });
    expect(run(deps)).toBe(1);
  });

  it("a non-zero exit with no findings is an error, not a pass (the audit died after printing {})", () => {
    const { deps, lines } = depsFor({ stdout: "{}", stderr: "fetch failed", status: 1 });
    expect(run(deps)).toBe(1);
    expect(lines).toEqual(["error: the audit could not run: fetch failed"]);
  });

  it("a zero exit with no findings is a clean pass", () => {
    const { deps } = depsFor({ stdout: "{}", status: 0 });
    expect(run(deps)).toBe(0);
  });

  it("a malformed allow file is an error and exit 1, before the audit result can pass", () => {
    const { deps, lines } = depsFor({ stdout: "{}", allow: "{not json" });
    expect(run(deps)).toBe(1);
    expect(lines[0]).toMatch(/^error: .*audit-allow\.json is malformed/);
  });
});

describe("the real allow file", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "..", ALLOW_FILE), "utf-8");

  it("decodes: a bad edit to the file fails here, not in CI after the push", () => {
    expect(Either.isRight(parseAllow(text))).toBe(true);
  });

  it("has no duplicate id and package pair and is sorted by package then id, so diffs stay small", () => {
    const entries = Either.getOrThrow(parseAllow(text));
    const keys = entries.map((e) => `${e.package}\0${e.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    const sorted = [...entries].sort(
      (a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id),
    );
    expect(entries).toEqual(sorted);
  });
});
