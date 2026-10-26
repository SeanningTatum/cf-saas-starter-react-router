/**
 * Records a demo: a walk worth showing in a PR that is not worth a committed test (a tour, a design
 * state, the mobile layout). Smoke videos come from the @golden and @error specs instead
 * (scripts/e2e-videos.ts); this is for everything else.
 *
 * Write a throwaway script under tmp/ (gitignored, and inside the repo so Bun resolves Playwright):
 *
 *   import { record } from "../scripts/lib/record";
 *   const r = await record({ out: ".verify/<slug>/video", name: "demo-settings-tour" }, async (page) => {
 *     await page.goto("http://localhost:<port>/settings");
 *     // ... the steps to show ...
 *   });
 *   console.log(JSON.stringify(r));
 *
 * Saves <out>/<name>.webm at 1280x720, slowed so a viewer can follow, and holds the last frame for a
 * second. A step that throws still saves the video up to that point and returns ok: false.
 * Name demos "demo-..." so the ship-feature review page shows them beside the smoke videos.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

export interface RecordOptions {
  out: string;
  name: string;
  slowMo?: number;
}

export interface Recording {
  path: string;
  ok: boolean;
  error?: string;
}

const SIZE = { width: 1280, height: 720 };

export async function record(
  { out, name, slowMo = 250 }: RecordOptions,
  steps: (page: Page) => Promise<void>,
  launch: (slowMo: number) => Promise<Browser> = (ms) => chromium.launch({ args: ["--disable-extensions"], slowMo: ms }),
  mkdir: (dir: string) => void = (dir) => mkdirSync(dir, { recursive: true })
): Promise<Recording> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return { path: "", ok: false, error: `name must be kebab-case: ${name}` };
  mkdir(out);
  const path = `${out}/${name}.webm`;
  const browser = await launch(slowMo);
  const context = await browser.newContext({ recordVideo: { dir: out, size: SIZE }, viewport: SIZE });
  const page = await context.newPage();
  let error: string | undefined;
  try {
    await steps(page);
    await page.waitForTimeout(1000);
  } catch (e) {
    error = String(e);
  } finally {
    // Playwright writes the video when its context closes; saveAs then copies it to a stable name.
    await context.close();
    await page.video()?.saveAs(path);
    await page.video()?.delete();
    await browser.close();
  }
  return error ? { path, ok: false, error } : { path, ok: true };
}
