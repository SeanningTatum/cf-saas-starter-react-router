/**
 * Records the smoke tests a PR reviewer should watch: every e2e test tagged @golden or @error.
 *
 *   bun run scripts/e2e-videos.ts --out <dir> [spec ...]      (no spec: every file in e2e/)
 *
 * Runs Playwright with E2E_VIDEO=1 (playwright.config.ts records and slows each test) and CI=1 (no
 * remote Cloudflare bindings, so no login), then copies each test's video to
 * <dir>/<golden|error>-<title>.webm (-2, -3, ... when two tests share a name). A failed test keeps
 * its video: it shows the failure.
 * Success prints { passed, videos: [{ kind, title, file, status, path }] } to stdout.
 * Exit codes: 0 every test passed, 1 a test failed (videos still saved), 2 usage or no report.
 *
 * Playwright and the file system are injected (`Deps`), so the tests never start a browser.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export type Kind = "golden" | "error";
export interface Video {
  kind: Kind;
  title: string;
  file: string;
  status: string;
  source: string;
}

interface Attachment { name: string; path?: string }
interface Result { status: string; attachments: Attachment[] }
interface Spec { title: string; file: string; tags?: string[]; tests: { results: Result[] }[] }
interface Suite { specs?: Spec[]; suites?: Suite[] }
export interface Report { suites?: Suite[] }

export interface Deps {
  playwright: (args: string[], env: Record<string, string>) => { code: number; stdout: string; stderr: string };
  mkdir: (dir: string) => void;
  copy: (from: string, to: string) => void;
}

/** The @golden and @error tests in a Playwright JSON report, with the video of each test's last attempt. */
export function collectVideos(report: Report): Video[] {
  const out: Video[] = [];
  const visit = (suite: Suite) => {
    for (const spec of suite.specs ?? []) {
      // The JSON reporter drops the "@" from tags.
      const kind = (spec.tags ?? []).map((t) => t.replace(/^@/, "")).find((t): t is Kind => t === "golden" || t === "error");
      if (!kind) continue;
      for (const test of spec.tests) {
        const last = test.results[test.results.length - 1];
        const video = last?.attachments.find((a) => a.name === "video" && a.path);
        if (video?.path) out.push({ kind, title: spec.title, file: spec.file, status: last.status, source: video.path });
      }
    }
    (suite.suites ?? []).forEach(visit);
  };
  (report.suites ?? []).forEach(visit);
  return out;
}

/** "signup → dashboard, signout → login" -> "golden-signup-dashboard-signout-login.webm" */
export function videoName(v: Pick<Video, "kind" | "title">): string {
  const slug = v.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return `${v.kind}-${slug || "test"}.webm`;
}

export function run(argv: string[], deps: Deps): { code: number; out?: unknown; err?: string } {
  const at = argv.indexOf("--out");
  const outDir = at >= 0 ? argv[at + 1] : undefined;
  if (!outDir || outDir.startsWith("--")) return { code: 2, err: "usage: bun run scripts/e2e-videos.ts --out <dir> [spec ...]" };
  const specs = argv.filter((_, i) => i !== at && i !== at + 1);

  const pw = deps.playwright(["playwright", "test", ...specs, "--grep", "@golden|@error", "--reporter=json"], { E2E_VIDEO: "1", CI: "1" });
  let report: Report;
  try {
    report = JSON.parse(pw.stdout) as Report;
  } catch {
    return { code: 2, err: `playwright gave no JSON report (exit ${pw.code}): ${pw.stderr.trim().split("\n").slice(-15).join("\n")}` };
  }

  const found = collectVideos(report);
  if (!found.length) return { code: 2, err: "no @golden or @error test recorded a video; tag them: test(title, { tag: \"@golden\" }, ...)" };
  deps.mkdir(outDir);
  // Two tests can share a title (across spec files, or after the slug is cut): number the later ones,
  // or the second copy would overwrite the first.
  const used = new Set<string>();
  const videos = found.map((v) => {
    const base = videoName(v).replace(/\.webm$/, "");
    let name = `${base}.webm`;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}.webm`;
    used.add(name);
    const path = join(outDir, name);
    deps.copy(v.source, path);
    return { kind: v.kind, title: v.title, file: v.file, status: v.status, path };
  });
  const passed = pw.code === 0 && videos.every((v) => v.status === "passed");
  return { code: passed ? 0 : 1, out: { passed, videos } };
}

if (import.meta.main) {
  const result = run(process.argv.slice(2), {
    playwright: (args, env) => {
      const r = spawnSync("bunx", args, { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    mkdir: (dir) => mkdirSync(dir, { recursive: true }),
    copy: copyFileSync,
  });
  if (result.out) console.log(JSON.stringify(result.out, null, 2));
  if (result.err) console.error(result.err);
  process.exit(result.code);
}
