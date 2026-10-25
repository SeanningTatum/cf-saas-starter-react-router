import { describe, it, expect } from "vitest";
import { run, type Deps, type GhResult } from "../tracker";

type Call = string[];

/** A gh stub: `reply` picks the answer for each call, every call is recorded. */
function stub(reply: (args: string[]) => Partial<GhResult>, files: Record<string, string> = { "b.md": "body text" }) {
  const calls: Call[] = [];
  const deps: Deps = {
    gh: (args) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "", ...reply(args) };
    },
    readFile: (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
  };
  return { deps, calls };
}

const issue = {
  number: 12,
  url: "https://github.com/acme/saas/issues/12",
  title: "Invites",
  body: "text",
  state: "OPEN",
  labels: [{ name: "feature" }, { name: "ui" }],
  updatedAt: "2026-10-24T10:00:00Z",
  comments: [{ id: "IC_1", author: { login: "sean" }, body: "hi", url: "https://github.com/acme/saas/issues/12#issuecomment-1" }],
};

describe("tracker view", () => {
  it("maps gh JSON to the contract shape: labels flatten to names, authors to logins, ref is '#n'", async () => {
    const { deps, calls } = stub(() => ({ stdout: JSON.stringify(issue) }));
    const o = await run(["view", "#12"], deps);
    expect(o.code).toBe(0);
    expect(o.out).toEqual({
      ref: "#12",
      number: 12,
      url: issue.url,
      title: "Invites",
      body: "text",
      state: "OPEN",
      labels: ["feature", "ui"],
      updatedAt: issue.updatedAt,
      comments: [{ id: "IC_1", author: "sean", body: "hi", url: issue.comments[0].url }],
    });
    expect(calls[0].slice(0, 3)).toEqual(["issue", "view", "12"]);
  });

  it("a URL ref passes -R owner/repo: otherwise gh reads the wrong repository", async () => {
    const { deps, calls } = stub(() => ({ stdout: JSON.stringify(issue) }));
    await run(["view", "https://github.com/acme/saas/issues/12"], deps);
    expect(calls[0]).toContain("-R");
    expect(calls[0]).toContain("acme/saas");
  });

  it("an issue gh cannot find exits 2 with NOT_FOUND: the workflow stops instead of planning from nothing", async () => {
    const { deps } = stub(() => ({ code: 1, stderr: "GraphQL: Could not resolve to an issue or pull request with the number of 999999." }));
    const o = await run(["view", "999999"], deps);
    expect(o.code).toBe(2);
    expect(o.err?.code).toBe("NOT_FOUND");
  });

  it("a logged-out gh exits 2 with AUTH, not NOT_FOUND: the fix differs", async () => {
    const { deps } = stub(() => ({ code: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login" }));
    const o = await run(["view", "12"], deps);
    expect(o.code).toBe(2);
    expect(o.err?.code).toBe("AUTH");
  });

  it("a bad ref exits 1 USAGE without calling gh", async () => {
    const { deps, calls } = stub(() => ({}));
    const o = await run(["view", "twelve"], deps);
    expect(o.code).toBe(1);
    expect(o.err?.code).toBe("USAGE");
    expect(calls).toEqual([]);
  });
});

describe("tracker create", () => {
  it("parses the number out of the URL gh prints and forwards every --label", async () => {
    const { deps, calls } = stub(() => ({ stdout: "https://github.com/acme/saas/issues/31\n" }));
    const o = await run(["create", "--title", "T", "--body-file", "b.md", "--label", "a", "--label", "b"], deps);
    expect(o.out).toEqual({ ref: "#31", number: 31, url: "https://github.com/acme/saas/issues/31" });
    expect(calls[0]).toEqual(["issue", "create", "--title", "T", "--body-file", "b.md", "--label", "a", "--label", "b"]);
  });

  it("a missing --title is a USAGE error, not an untitled issue", async () => {
    const { deps } = stub(() => ({}));
    expect((await run(["create", "--body-file", "b.md"], deps)).code).toBe(1);
  });

  it("an unreadable body file is a USAGE error: gh must not create an empty issue", async () => {
    const { deps, calls } = stub(() => ({}));
    const o = await run(["create", "--title", "T", "--body-file", "nope.md"], deps);
    expect(o.code).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe("tracker edit", () => {
  const reply = (updatedAt: string) => (args: string[]) =>
    args[1] === "view" ? { stdout: JSON.stringify({ url: issue.url, updatedAt }) } : {};

  it("writes the body and reports the new updatedAt", async () => {
    const { deps, calls } = stub(reply("2026-10-24T11:00:00Z"));
    const o = await run(["edit", "12", "--body-file", "b.md", "--title", "New"], deps);
    expect(o.out).toEqual({ ref: "#12", url: issue.url, updatedAt: "2026-10-24T11:00:00Z" });
    expect(calls.find((c) => c[1] === "edit")).toEqual(["issue", "edit", "12", "--body-file", "b.md", "--title", "New"]);
  });

  it("--if-updated-at that no longer matches exits 3 STALE and never writes: a human edit must not be overwritten", async () => {
    const { deps, calls } = stub(reply("2026-10-24T12:00:00Z"));
    const o = await run(["edit", "12", "--body-file", "b.md", "--if-updated-at", "2026-10-24T10:00:00Z"], deps);
    expect(o.code).toBe(3);
    expect(o.err?.code).toBe("STALE");
    expect(calls.some((c) => c[1] === "edit")).toBe(false);
  });

  /** Stub for the guarded path: view (updatedAt / id / url), api user, api graphql, issue edit. */
  const guarded = (opts: { updatedAt?: string; edits?: object[] } = {}) => {
    return stub((args) => {
      if (args[0] === "api" && args[1] === "user") return { stdout: "sean\n" };
      if (args[0] === "api" && args[1] === "graphql")
        return { stdout: JSON.stringify({ data: { node: { userContentEdits: { nodes: opts.edits ?? [] } } } }) };
      if (args[1] === "view") {
        const f = args[args.indexOf("--json") + 1];
        if (f === "id") return { stdout: JSON.stringify({ id: "I_node" }) };
        return { stdout: JSON.stringify({ url: issue.url, updatedAt: opts.updatedAt ?? "2026-10-24T10:00:00Z" }) };
      }
      return {};
    });
  };
  const withNow = (d: Deps): Deps => ({ ...d, now: () => "2026-10-24T10:05:00Z" });
  const guardedArgs = ["edit", "12", "--body-file", "b.md", "--if-updated-at", "2026-10-24T10:00:00Z"];

  it("--if-updated-at that matches and shows no foreign edit writes cleanly", async () => {
    const { deps, calls } = guarded();
    const o = await run(guardedArgs, withNow(deps));
    expect(o.code).toBe(0);
    expect(calls.some((c) => c[1] === "edit")).toBe(true);
    expect(calls.some((c) => c[1] === "graphql")).toBe(true);
  });

  it("an edit by someone else between the check and our write exits 3 STALE_AFTER_WRITE with their text: the caller can restore it", async () => {
    const { deps } = guarded({ edits: [{ editor: { login: "maria" }, editedAt: "2026-10-24T10:03:00Z", diff: "maria's text" }] });
    const o = await run(guardedArgs, withNow(deps));
    expect(o.code).toBe(3);
    expect(o.err?.code).toBe("STALE_AFTER_WRITE");
    expect(o.err?.body).toBe("maria's text");
  });

  it("an edit by someone else that lands while our gh command runs (after the pre-write clock, before our own edit) exits 3 STALE_AFTER_WRITE", async () => {
    const { deps } = guarded({
      edits: [
        { editor: { login: "maria" }, editedAt: "2026-10-24T10:06:00Z", diff: "maria's in-flight text" },
        { editor: { login: "sean" }, editedAt: "2026-10-24T10:07:00Z", diff: "mine" },
      ],
    });
    const o = await run(guardedArgs, withNow(deps));
    expect(o.err?.code).toBe("STALE_AFTER_WRITE");
    expect(o.err?.body).toBe("maria's in-flight text");
  });

  it("an edit by someone else stamped in the same second as our own edit exits 3 STALE_AFTER_WRITE: GitHub times are whole seconds, so a tie is a conflict", async () => {
    const { deps } = guarded({
      edits: [
        { editor: { login: "maria" }, editedAt: "2026-10-24T10:07:00Z", diff: "maria's same-second text" },
        { editor: { login: "sean" }, editedAt: "2026-10-24T10:07:00Z", diff: "mine" },
      ],
    });
    const o = await run(guardedArgs, withNow(deps));
    expect(o.err?.code).toBe("STALE_AFTER_WRITE");
    expect(o.err?.body).toBe("maria's same-second text");
  });

  it("our own edits and edits outside the window do not trip STALE_AFTER_WRITE: a false alarm would block every run", async () => {
    const { deps } = guarded({
      edits: [
        { editor: { login: "sean" }, editedAt: "2026-10-24T10:03:00Z", diff: "mine" },
        { editor: { login: "maria" }, editedAt: "2026-10-24T09:00:00Z", diff: "before the check" },
        { editor: { login: "maria" }, editedAt: "2026-10-24T10:09:00Z", diff: "after our write" },
      ],
    });
    expect((await run(guardedArgs, withNow(deps))).code).toBe(0);
  });

  it("without --if-updated-at no graphql call is made: unguarded edits stay cheap", async () => {
    const { deps, calls } = stub((a) => (a[1] === "view" ? { stdout: JSON.stringify({ url: issue.url, updatedAt: "x" }) } : {}));
    await run(["edit", "12", "--body-file", "b.md"], deps);
    expect(calls.some((c) => c[1] === "graphql")).toBe(false);
  });
});

describe("tracker comment", () => {
  it("returns the numeric comment id taken from the URL gh prints", async () => {
    const { deps } = stub(() => ({ stdout: "https://github.com/acme/saas/issues/12#issuecomment-4455\n" }));
    const o = await run(["comment", "12", "--body-file", "b.md"], deps);
    expect(o.out).toEqual({ id: "4455", url: "https://github.com/acme/saas/issues/12#issuecomment-4455" });
  });
});

describe("tracker upsert-comment", () => {
  const marker = "<!-- plan-feature:record -->";
  const url = "https://github.com/acme/saas/issues/12";
  const args = ["upsert-comment", "12", "--marker", "record", "--body-file", "b.md"];
  const line = (o: object) => JSON.stringify(o) + "\n";
  const reply = (comments: string, patch?: Partial<GhResult>) => (a: string[]) => {
    if (a[0] === "repo") return { stdout: "acme/saas\n" };
    if (a[0] === "api" && a[1] === "user") return { stdout: "sean\n" };
    if (a.includes("--paginate")) return { stdout: comments };
    if (a.includes("PATCH")) return patch ?? { stdout: JSON.stringify({ id: 55, html_url: `${url}#issuecomment-55` }) };
    return { stdout: JSON.stringify({ id: 77, html_url: `${url}#issuecomment-77` }) };
  };

  it("creates when no comment carries the marker: POST with the marker prepended to the body", async () => {
    const { deps, calls } = stub(reply(line({ id: 1, html_url: "u", body: "unrelated", author: "sean" })));
    const o = await run(args, deps);
    expect(o.out).toEqual({ id: "77", url: `${url}#issuecomment-77`, action: "created" });
    const post = calls.find((c) => c.includes("POST"))!;
    expect(post).toContain("repos/acme/saas/issues/12/comments");
    expect(post).toContain(`body=${marker}\nbody text`);
  });

  it("updates the current user's marked comment in place: PATCH that id, no duplicate comment", async () => {
    const { deps, calls } = stub(
      reply(line({ id: 1, html_url: "u1", body: "unrelated", author: "sean" }) + line({ id: 55, html_url: "u", body: `${marker}\nold`, author: "sean" })),
    );
    const o = await run(args, deps);
    expect(o.out).toEqual({ id: "55", url: `${url}#issuecomment-55`, action: "updated" });
    expect(calls.find((c) => c.includes("PATCH"))).toContain("repos/acme/saas/issues/comments/55");
    expect(calls.some((c) => c.includes("POST"))).toBe(false);
  });

  it("the newest own marked comment wins over an older own one", async () => {
    const { deps, calls } = stub(
      reply(line({ id: 10, html_url: "u", body: marker, author: "sean" }) + line({ id: 20, html_url: "u", body: marker, author: "sean" })),
    );
    await run(args, deps);
    expect(calls.find((c) => c.includes("PATCH"))).toContain("repos/acme/saas/issues/comments/20");
  });

  it("marked comments only from other authors are not PATCHed: a new one is created and the old ids are reported as superseded", async () => {
    const { deps, calls } = stub(reply(line({ id: 9, html_url: "u", body: marker, author: "maria" })));
    const o = await run(args, deps);
    expect(o.out).toEqual({ id: "77", url: `${url}#issuecomment-77`, action: "created", superseded: ["9"] });
    expect(calls.some((c) => c.includes("PATCH"))).toBe(false);
  });

  it("a PATCH refused with 403 falls back to a new comment: the update must not abort the run", async () => {
    const { deps } = stub(
      reply(line({ id: 55, html_url: "u", body: marker, author: "sean" }), { code: 1, stderr: "gh: Forbidden (HTTP 403)" }),
    );
    const o = await run(args, deps);
    expect(o.out).toEqual({ id: "77", url: `${url}#issuecomment-77`, action: "created", superseded: ["55"] });
  });

  it("a URL ref supplies owner/repo itself: no 'gh repo view' call, so it works outside a checkout", async () => {
    const { deps, calls } = stub(reply(""));
    await run(["upsert-comment", url, "--marker", "record", "--body-file", "b.md"], deps);
    expect(calls.some((c) => c[0] === "repo")).toBe(false);
    expect(calls.some((c) => c.includes("repos/acme/saas/issues/12/comments"))).toBe(true);
  });

  it("a different marker key does not match another key's comment: two records on one issue stay separate", async () => {
    const { deps, calls } = stub(reply(line({ id: 5, html_url: "u", body: "<!-- plan-feature:other -->\nx", author: "sean" })));
    const o = await run(args, deps);
    expect((o.out as { action: string }).action).toBe("created");
    expect(calls.some((c) => c.includes("PATCH"))).toBe(false);
  });
});

describe("tracker backends and usage", () => {
  it("--backend linear exits 4 BACKEND with the task t1 help: the workflow knows to ask the user", async () => {
    const { deps, calls } = stub(() => ({}));
    const o = await run(["view", "12", "--backend", "linear"], deps);
    expect(o.code).toBe(4);
    expect(o.err?.code).toBe("BACKEND");
    expect(o.err?.help).toContain("task t1");
    expect(calls).toEqual([]);
  });

  it("a misspelled flag exits 1 USAGE before any gh call: a typo'd --if-update-at must not silently drop the stale guard", async () => {
    const { deps, calls } = stub(() => ({}));
    const o = await run(["edit", "12", "--body-file", "b.md", "--if-update-at", "x"], deps);
    expect(o.code).toBe(1);
    expect(o.err?.code).toBe("USAGE");
    expect(calls).toEqual([]);
  });

  it("an unknown verb exits 1 USAGE", async () => {
    const { deps } = stub(() => ({}));
    const o = await run(["close", "12"], deps);
    expect(o.code).toBe(1);
    expect(o.err?.code).toBe("USAGE");
  });

  it("every error carries error, code and help: the workflow prints help to the user verbatim", async () => {
    const { deps } = stub(() => ({ code: 1, stderr: "HTTP 404" }));
    const o = await run(["view", "1"], deps);
    expect(Object.keys(o.err!).sort()).toEqual(["code", "error", "help"]);
  });
});
