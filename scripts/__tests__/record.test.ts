import { describe, it, expect } from "vitest";
import type { Browser, Page } from "@playwright/test";
import { record } from "../lib/record";

/** A fake browser that logs every call in order, so a test can check what was saved and closed. */
function fakeBrowser() {
  const calls: string[] = [];
  const video = {
    saveAs: async (p: string) => void calls.push(`saveAs ${p}`),
    delete: async () => void calls.push("delete"),
  };
  const page = { video: () => video, waitForTimeout: async () => void calls.push("hold"), goto: async () => {} };
  const context = { newPage: async () => page, close: async () => void calls.push("context.close") };
  const browser = {
    newContext: async (o: { recordVideo: { dir: string } }) => (calls.push(`newContext ${o.recordVideo.dir}`), context),
    close: async () => void calls.push("browser.close"),
  };
  let slowMo = -1;
  const launch = async (ms: number) => ((slowMo = ms), browser as unknown as Browser);
  return { calls, launch, slowMo: () => slowMo };
}
const noMkdir = () => {};

describe("record", () => {
  it("saves <out>/<name>.webm after the context closes, then drops Playwright's randomly named copy", async () => {
    const f = fakeBrowser();
    const r = await record({ out: ".verify/x/video", name: "demo-tour" }, async () => {}, f.launch, noMkdir);
    expect(r).toEqual({ path: ".verify/x/video/demo-tour.webm", ok: true });
    expect(f.calls).toEqual(["newContext .verify/x/video", "hold", "context.close", "saveAs .verify/x/video/demo-tour.webm", "delete", "browser.close"]);
  });

  it("a step that throws still saves the video and closes the browser: the half-walk is the evidence", async () => {
    const f = fakeBrowser();
    const r = await record({ out: "o", name: "demo-x" }, async () => Promise.reject(new Error("no button")), f.launch, noMkdir);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("no button") });
    expect(f.calls).toContain("saveAs o/demo-x.webm");
    expect(f.calls.at(-1)).toBe("browser.close");
  });

  it("slows the walk by default so a viewer can follow it", async () => {
    const f = fakeBrowser();
    await record({ out: "o", name: "demo-x" }, async (_p: Page) => {}, f.launch, noMkdir);
    expect(f.slowMo()).toBe(250);
  });

  it("refuses a name that is not kebab-case before launching a browser: '../' would write outside out", async () => {
    const f = fakeBrowser();
    const r = await record({ out: "o", name: "../escape" }, async () => {}, f.launch, noMkdir);
    expect(r.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
});
