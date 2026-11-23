import { Either } from "effect";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBody } from "../lib/size-report";
import { ROOT, SLUG, STATE, world } from "./helpers/wave-world";

describe("wave rollup", () => {
  it("a second run on a wave branch with an open roll-up PR ends with that PR's number, adds its tickets under a dated heading, and keeps the person's text", async () => {
    const w = world();
    await w.approved();
    await w.green(11);
    await w.out(["merge", SLUG]);
    w.lists.rollup = JSON.stringify([{ number: 77, body: "A person wrote this line.\n\n## Size\n\nold table" }]);
    const sizeFile = join(ROOT, ".verify", SLUG, "size.md");
    w.files.set(sizeFile, "## Size\n\nnew table");
    expect(await w.out(["rollup", SLUG, "--title", "v3.0 wave 2", "--size-file", sizeFile])).toEqual({ pr: 77 });
    expect(w.calls).toContainEqual(["pr", "edit", "77", "--body-file", "-"]);
    const body = w.edits[0]?.body ?? "";
    expect(body.startsWith("A person wrote this line.")).toBe(true);
    expect(body).toContain("## Run 1970-01-01 (wave-two)\n\n- #11 Billing schema (PR #111)");
    expect(body).toContain("new table");
    expect(body).not.toContain("old table");
    expect(await w.out(["rollup", SLUG, "--title", "v3.0 wave 2", "--size-file", sizeFile])).toEqual({ pr: 77 });
    expect(w.edits[1]?.body).toBe(body);
  });

  it("an update with no size file keeps the old size table, so a passing body does not turn red", async () => {
    const table = "## Size\n\n| | base | This PR | Change |\n|---|---:|---:|---:|\n| Worker upload, gzip | 1 | 1 | 0 |";
    const w = world();
    await w.approved();
    w.lists.rollup = JSON.stringify([{ number: 77, body: `text\n\n${table}` }]);
    await w.out(["rollup", SLUG, "--title", "t"]);
    expect(Either.isRight(checkBody(w.edits[0]?.body ?? "", ["app/a.ts"]))).toBe(true);
  });

  it("merged lists every merged ticket, for the clean-up on a restart", async () => {
    const w = world();
    await w.approved();
    await w.green(11);
    await w.out(["merge", SLUG]);
    expect(await w.out(["merged", SLUG])).toEqual({ merged: [11] });
  });

  it("a roll-up that changes app/ carries the size table in its own body, new PR or old, so the PR body check passes", async () => {
    const table = "## Size\n\n| | base | This PR | Change |\n|---|---:|---:|---:|\n| Worker upload, gzip | 1 | 1 | 0 |";
    const w = world();
    await w.approved();
    const sizeFile = join(ROOT, ".verify", SLUG, "size.md");
    w.files.set(sizeFile, table);
    await w.out(["rollup", SLUG, "--title", "t", "--size-file", sizeFile]);
    expect(Either.isRight(checkBody(w.bodies[0] ?? "", ["app/a.ts"]))).toBe(true);
    expect(Either.isLeft(checkBody("Closes", ["app/a.ts"]))).toBe(true);
    w.lists.rollup = JSON.stringify([{ number: 77, body: "text" }]);
    await w.out(["rollup", SLUG, "--title", "t", "--size-file", sizeFile]);
    expect(Either.isRight(checkBody(w.edits[0]?.body ?? "", ["app/a.ts"]))).toBe(true);
  });

  it("rollup refuses a size file outside the wave's own folder or one that is missing", async () => {
    const w = world();
    await w.approved();
    expect((await w.cli(["rollup", SLUG, "--title", "t", "--size-file", "/etc/hosts"])).code).toBe(2);
    expect((await w.cli(["rollup", SLUG, "--title", "t", "--size-file", join(ROOT, ".verify", SLUG, "none.md")])).code).toBe(1);
  });

  it("status lists the P2 and P3 findings the review kept, and an old state file without them still reads", async () => {
    const w = world();
    await w.approved();
    await w.open(11);
    await w.out(["event", SLUG], JSON.stringify({ type: "reviewed", n: 11, blocking: [], kept: ["P3 app/a.ts rename x"] }));
    const status = await w.cli(["status", SLUG]);
    expect(status.stdout.join("\n")).toContain("kept findings (P2 and P3, never blocking):\n  #11: P3 app/a.ts rename x");
    const old = JSON.parse(w.files.get(STATE) ?? "null");
    for (const t of old.tickets) delete t.kept;
    w.files.set(STATE, JSON.stringify(old));
    expect((await w.cli(["status", SLUG])).code).toBe(0);
    expect(w.ticket(11).kept).toBeUndefined();
  });
});
