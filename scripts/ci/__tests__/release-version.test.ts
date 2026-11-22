import { describe, expect, it } from "vitest";
import { releaseVersion, run, type Deps } from "../release-version";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "89abcdef0123456789abcdef0123456789abcdef";

const listing = (...rows: [string, string][]): string => rows.map(([sha, ref]) => `${sha} ${ref}`).join("\n");

const runWith = (argv: string[], input: string): { code: number; lines: string[] } => {
  const lines: string[] = [];
  const deps: Deps = { readInput: () => input, log: (line) => lines.push(line) };
  return { code: run(argv, deps), lines };
};

describe("releaseVersion", () => {
  it("names the version tag that sits on the commit: reports then group by v3.0.0, not by a sha", () => {
    expect(releaseVersion(listing([SHA, "refs/tags/v3.0.0"], [OTHER, "refs/tags/v2.4.0"]), SHA)).toBe("v3.0.0");
  });

  it("falls back to the commit sha when no tag is on it yet: the release workflow may not have run", () => {
    expect(releaseVersion(listing([OTHER, "refs/tags/v2.4.0"]), SHA)).toBe(SHA);
    expect(releaseVersion("", SHA)).toBe(SHA);
  });

  it("takes the highest version by number when two tags share the commit, so v2.10.0 beats v2.9.0", () => {
    expect(releaseVersion(listing([SHA, "refs/tags/v2.9.0"], [SHA, "refs/tags/v2.10.0"]), SHA)).toBe("v2.10.0");
  });

  it("ignores tags that are not plain versions and refs that are not tags: a stray name must not become the release", () => {
    const rows = listing([SHA, "refs/tags/vnext"], [SHA, "refs/tags/v1.2"], [SHA, "refs/heads/v9.9.9"], [SHA, "refs/tags/v1.2.3-rc.1"]);
    expect(releaseVersion(rows, SHA)).toBe(SHA);
  });

  it("reads a listing with blank lines, carriage returns and a repeated row", () => {
    const rows = `\r\n${SHA} refs/tags/v3.0.0\r\n\n${SHA} refs/tags/v3.0.0\r\n`;
    expect(releaseVersion(rows, SHA)).toBe("v3.0.0");
  });

  it("does not match a tag by a short sha: only the full commit sha names its tag", () => {
    expect(releaseVersion(listing([SHA, "refs/tags/v3.0.0"]), SHA.slice(0, 7))).toBe(SHA.slice(0, 7));
  });

  it("refuses a value that is not a hex sha: it would reach a wrangler argument", () => {
    expect(releaseVersion("", "$(id)")).toBeUndefined();
    expect(releaseVersion("", "abc")).toBeUndefined();
    expect(releaseVersion("", "--help")).toBeUndefined();
  });
});

describe("run", () => {
  it("prints one version= line for GITHUB_OUTPUT and exits 0", () => {
    expect(runWith([SHA], listing([SHA, "refs/tags/v3.0.0"]))).toEqual({ code: 0, lines: ["version=v3.0.0"] });
  });

  it("lower-cases and trims the sha it was given before it matches tags", () => {
    expect(runWith([` ${SHA.toUpperCase()} `], listing([SHA, "refs/tags/v1.0.0"])).lines).toEqual(["version=v1.0.0"]);
  });

  it("exits 1 with an error line and no version when the sha is bad, so the deploy stops before it names a release", () => {
    const outcome = runWith(["not-a-sha"], "");
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join("\n")).not.toContain("version=");
  });

  it("exits 1 with the usage line when the sha is missing or there are extra arguments", () => {
    expect(runWith([], "").code).toBe(1);
    expect(runWith([SHA, "extra"], "").code).toBe(1);
  });
});
