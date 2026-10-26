import { describe, it, expect } from "vitest";
import { collectVideos, videoName, run, type Deps, type Report } from "../e2e-videos";

const spec = (title: string, tags: string[], results: { status: string; video?: string }[]) => ({
  title,
  file: "auth.spec.ts",
  tags,
  tests: [{ results: results.map((r) => ({ status: r.status, attachments: r.video ? [{ name: "video", path: r.video }] : [] })) }],
});

// The shape Playwright 1.58's JSON reporter writes: nested suites, tags without "@".
const report: Report = {
  suites: [
    {
      suites: [
        {
          specs: [
            spec("signup → dashboard", ["golden"], [{ status: "failed", video: "/r/try1.webm" }, { status: "passed", video: "/r/try2.webm" }]),
            spec("login rejects bad credentials", ["error"], [{ status: "passed", video: "/r/err.webm" }]),
            spec("pillars render", [], [{ status: "passed", video: "/r/home.webm" }]),
          ],
        },
      ],
    },
  ],
};

function stub(code = 0, stdout = JSON.stringify(report)) {
  const calls: { args: string[]; env: Record<string, string> }[] = [];
  const copies: [string, string][] = [];
  const deps: Deps = {
    playwright: (args, env) => {
      calls.push({ args, env });
      return { code, stdout, stderr: "boom" };
    },
    mkdir: () => {},
    copy: (from, to) => copies.push([from, to]),
  };
  return { deps, calls, copies };
}

describe("collectVideos", () => {
  it("keeps only @golden and @error tests: an untagged smoke test must not end up in the PR", () => {
    expect(collectVideos(report).map((v) => v.kind)).toEqual(["golden", "error"]);
  });

  it("takes the last attempt's video: a retried test must show the run that counted, not the flake", () => {
    expect(collectVideos(report)[0]).toMatchObject({ source: "/r/try2.webm", status: "passed" });
  });

  it("accepts tags with or without '@', in case the reporter format changes", () => {
    const at: Report = { suites: [{ specs: [spec("x", ["@golden"], [{ status: "passed", video: "/v.webm" }])] }] };
    expect(collectVideos(at)).toHaveLength(1);
  });
});

describe("videoName", () => {
  it("turns a title with arrows and commas into a safe file name", () => {
    expect(videoName({ kind: "golden", title: "signup → dashboard, signout → login" })).toBe("golden-signup-dashboard-signout-login.webm");
  });

  it("never yields an empty slug: a title of symbols still gets a name", () => {
    expect(videoName({ kind: "error", title: "→ ←" })).toBe("error-test.webm");
  });
});

describe("run", () => {
  it("records with E2E_VIDEO and CI set, filtered to the tagged tests, on the given specs", () => {
    const { deps, calls } = stub();
    run(["--out", ".verify/x/video", "e2e/auth.spec.ts"], deps);
    expect(calls[0].args).toEqual(["playwright", "test", "e2e/auth.spec.ts", "--grep", "@golden|@error", "--reporter=json"]);
    expect(calls[0].env).toEqual({ E2E_VIDEO: "1", CI: "1" });
  });

  it("copies each video into --out under its kind and title", () => {
    const { deps, copies } = stub();
    const r = run(["--out", "out"], deps);
    expect(r.code).toBe(0);
    expect(copies).toEqual([
      ["/r/try2.webm", "out/golden-signup-dashboard.webm"],
      ["/r/err.webm", "out/error-login-rejects-bad-credentials.webm"],
    ]);
  });

  it("a failing run still saves its videos but exits 1: the video shows the failure, the code blocks the ship", () => {
    const failed: Report = { suites: [{ specs: [spec("x", ["golden"], [{ status: "failed", video: "/f.webm" }])] }] };
    const { deps, copies } = stub(1, JSON.stringify(failed));
    const r = run(["--out", "out"], deps);
    expect(r.code).toBe(1);
    expect(copies).toHaveLength(1);
    expect(r.out).toMatchObject({ passed: false });
  });

  it("exits 2 when Playwright crashes before writing a report, quoting its stderr", () => {
    const { deps } = stub(1, "not json");
    expect(run(["--out", "out"], deps)).toMatchObject({ code: 2, err: expect.stringContaining("boom") });
  });

  it("exits 2 when no test is tagged, rather than reporting success with no videos", () => {
    const { deps } = stub(0, JSON.stringify({ suites: [{ specs: [spec("x", [], [{ status: "passed", video: "/v.webm" }])] }] }));
    expect(run(["--out", "out"], deps)).toMatchObject({ code: 2, err: expect.stringContaining("@golden") });
  });

  it("exits 2 without --out, before starting a browser", () => {
    const { deps, calls } = stub();
    expect(run(["e2e/auth.spec.ts"], deps).code).toBe(2);
    expect(calls).toHaveLength(0);
  });
});
