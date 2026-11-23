import { Either } from "effect";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fetchAnswer,
  judge,
  parseArgs,
  parseOrigin,
  parsePin,
  requestHeaders,
  run,
  smokeCheck,
  type CliDeps,
  type HttpAnswer,
  type SmokeOptions,
} from "../smoke-check";

const VERSION = "dc8dcd28-271b-4367-9840-6c244f84cb40";
const FAST: SmokeOptions = { attempts: 3, delayMs: 7_000, timeoutMs: 1_000 };
const up = (release = "v3.1.0"): HttpAnswer => ({ status: 200, body: JSON.stringify({ status: "up", release }) });
const down: HttpAnswer = { status: 503, body: JSON.stringify({ status: "down", release: "v3.1.0" }) };

function harness(answers: (HttpAnswer | undefined)[], env: Record<string, string> = {}) {
  const requests: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const appended: string[] = [];
  let next = 0;
  const deps: CliDeps = {
    env,
    fetch: (url, headers) => {
      requests.push({ url, headers });
      const answer = answers[Math.min(next, answers.length - 1)];
      next += 1;
      return Promise.resolve(answer);
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    log: (line) => logs.push(line),
    appendFile: (_file, text) => appended.push(text),
  };
  return { deps, requests, sleeps, logs, appended };
}

describe("judge", () => {
  it("passes a 200 up with the expected release, so that a healthy new version is let through", () => {
    expect(judge(up(), "v3.1.0")).toEqual({ ok: true, release: "v3.1.0" });
  });

  it("fails an up answer from another release, so that an ignored version pin is never read as the new version passing", () => {
    const verdict = judge(up("v3.0.9"), "v3.1.0");
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining("expected v3.1.0") });
  });

  it("passes any release when none is expected, so that a check of the live site needs no version", () => {
    expect(judge(up("abc123"), undefined)).toEqual({ ok: true, release: "abc123" });
  });

  it("names a 503 down as the database, a 500 by its status, a missing answer and a non-health body, so that the log says what broke", () => {
    expect(judge(down, undefined)).toMatchObject({ ok: false, reason: expect.stringContaining("database") });
    expect(judge({ status: 500, body: "Internal Server Error" }, undefined)).toMatchObject({ reason: "answered HTTP 500" });
    expect(judge(undefined, undefined)).toMatchObject({ reason: expect.stringContaining("no answer") });
    expect(judge({ status: 200, body: "<html>" }, undefined)).toMatchObject({ reason: expect.stringContaining("health shape") });
    expect(judge({ status: 200, body: JSON.stringify({ status: "down", release: "x" }) }, undefined).ok).toBe(false);
  });

  it("fails a redirect, so that a login page or a moved route never counts as healthy", () => {
    expect(judge({ status: 302, body: "" }, undefined)).toMatchObject({ ok: false, reason: "answered HTTP 302" });
  });
});

describe("release text from the body", () => {
  it("refuses a release with a newline, a workflow command or 65 characters, so that a hostile body cannot write a line into the job log or summary", () => {
    for (const release of ["v1\n::error::forged", "a".repeat(65), "", "v1 two"]) {
      const verdict = judge({ status: 200, body: JSON.stringify({ status: "up", release }) }, undefined);
      expect(verdict, JSON.stringify(release)).toMatchObject({ ok: false, reason: expect.stringContaining("health shape") });
    }
  });

  it("refuses an empty or unsafe --release, so that an unset CI variable cannot silently turn the release check off", () => {
    expect(Either.isLeft(parseArgs(["--url", "https://a.example.com", "--release", ""]))).toBe(true);
    expect(Either.isLeft(parseArgs(["--url", "https://a.example.com", "--release", "v1\nx"]))).toBe(true);
  });
});

describe("smokeCheck", () => {
  it("retries until the new release answers and stops there, so that a deployment still spreading is not rolled back", async () => {
    const h = harness([undefined, up("v3.0.9"), up("v3.1.0"), up("v3.1.0")]);
    const verdict = await smokeCheck({ origin: "https://app.example.com", release: "v3.1.0" }, h.deps, { ...FAST, attempts: 5 });
    expect(verdict.ok).toBe(true);
    expect(h.requests).toHaveLength(3);
    expect(h.sleeps).toEqual([7_000, 7_000]);
  });

  it("gives up after the set attempts with one ::error:: line naming the last reason, so that a broken version fails in bounded time", async () => {
    const h = harness([down]);
    const verdict = await smokeCheck({ origin: "https://app.example.com" }, h.deps, FAST);
    expect(verdict.ok).toBe(false);
    expect(h.requests).toHaveLength(3);
    expect(h.sleeps).toHaveLength(2);
    const errors = h.logs.filter((line) => line.startsWith("::error::"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("after 3 attempts 7 seconds apart");
    expect(errors[0]).toContain("database");
  });

  it("asks /healthz on the origin and pins the version with the override header, so that the check reaches the new version during a split", async () => {
    const h = harness([up()]);
    await smokeCheck({ origin: "https://app.example.com", pin: { worker: "my-app", versionId: VERSION } }, h.deps, FAST);
    expect(h.requests[0]?.url).toBe("https://app.example.com/healthz");
    expect(h.requests[0]?.headers).toEqual({ "Cloudflare-Workers-Version-Overrides": `my-app="${VERSION}"` });
  });

  it("sends no override header when no version is pinned, so that the live split answers", () => {
    expect(requestHeaders(undefined)).toEqual({});
  });
});

describe("argument checks", () => {
  it("takes an https origin or http on localhost and refuses a path, a query, credentials or plain http elsewhere, so that the check cannot be pointed at a page that always answers 200", () => {
    expect(parseOrigin("https://app.example.com")).toEqual(Either.right("https://app.example.com"));
    expect(parseOrigin("https://app.example.com/")).toEqual(Either.right("https://app.example.com"));
    expect(parseOrigin("http://localhost:5173")).toEqual(Either.right("http://localhost:5173"));
    for (const bad of [
      "http://app.example.com",
      "https://app.example.com/login",
      "https://app.example.com?x=1",
      "https://u:p@app.example.com",
      "not a url",
      "file:///etc/passwd",
    ]) {
      expect(Either.isLeft(parseOrigin(bad)), bad).toBe(true);
    }
  });

  it("takes a Worker name and a version UUID together or not at all, and refuses a quote or a newline, so that no header can be forged through the pin", () => {
    expect(parsePin(undefined, undefined)).toEqual(Either.right(undefined));
    expect(Either.isLeft(parsePin("my-app", undefined))).toBe(true);
    expect(Either.isLeft(parsePin('my-app",other="x', VERSION))).toBe(true);
    expect(Either.isLeft(parsePin("my-app", `${VERSION}\r\nx: y`))).toBe(true);
    expect(parsePin("my-app", VERSION)).toEqual(Either.right({ worker: "my-app", versionId: VERSION }));
  });

  it("refuses an unknown flag, a flag with no value and a missing --url, so that a typo in the workflow fails loudly", () => {
    expect(Either.isLeft(parseArgs(["--url"]))).toBe(true);
    expect(Either.isLeft(parseArgs(["--release", "v1"]))).toBe(true);
    expect(Either.isLeft(parseArgs(["--url", "https://a.example.com", "--force", "x"]))).toBe(true);
    expect(parseArgs(["--url", "https://a.example.com", "--release", "v1"])).toEqual(Either.right({ origin: "https://a.example.com", release: "v1" }));
  });
});

describe("run", () => {
  it("exits 0 and writes a summary line on a pass, so that the deploy goes on and the run page says what was checked", async () => {
    const h = harness([up()], { GITHUB_STEP_SUMMARY: "summary.md" });
    expect(await run(["--url", "https://app.example.com", "--release", "v3.1.0"], h.deps, FAST)).toBe(0);
    expect(h.appended.join("")).toContain("https://app.example.com/healthz");
  });

  it("exits 1 on a failed check and 2 on bad arguments, so that a workflow can tell a broken site from a broken call", async () => {
    expect(await run(["--url", "https://app.example.com"], harness([down]).deps, FAST)).toBe(1);
    expect(await run(["--url", "http://app.example.com"], harness([up()]).deps, FAST)).toBe(2);
  });
});

describe("fetchAnswer", () => {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/healthz" }).end();
      return;
    }
    if (request.url === "/slow") {
      setTimeout(() => response.end("late"), 2_000);
      return;
    }
    const probe = request.headers["x-probe"];
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "up", release: typeof probe === "string" ? probe : "none" }));
  });
  let origin = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("returns the status and body and sends the given headers, so that the judge reads what the server said", async () => {
    const answer = await fetchAnswer(`${origin}/healthz`, { "x-probe": "v9" }, 1_000);
    expect(answer?.status).toBe(200);
    expect(JSON.parse(answer?.body ?? "{}")).toEqual({ status: "up", release: "v9" });
  });

  it("does not follow a redirect, so that a 302 to a healthy page still fails the check", async () => {
    expect((await fetchAnswer(`${origin}/redirect`, {}, 1_000))?.status).toBe(302);
  });

  it("gives no answer after the timeout or on a refused connection, so that a hung version counts as a failed attempt", async () => {
    expect(await fetchAnswer(`${origin}/slow`, {}, 100)).toBeUndefined();
    expect(await fetchAnswer("http://127.0.0.1:1/healthz", {}, 500)).toBeUndefined();
  });
});
