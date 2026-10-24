/**
 * Deterministic craft audit for a rendered surface.
 *
 * The lead design skill's critique judges taste. This script measures the mechanics taste sits on, so
 * the critique argues about the right things and nobody has to take "it looks premium" on faith.
 *
 * Four passes of a sample surface were rejected by a human reviewer before one landed. Every rejection
 * traced to something on this list: no real typeface, no depth, an accent spent everywhere, no product
 * surface shown, or a still page for a subject that moves. Those are all countable, so they get
 * counted.
 *
 *   CI=1 bun run dev --port 5231     # CI=1 skips the Workers-AI remote-bindings proxy session
 *   bun run design:audit -- --url http://localhost:5231/<route> --scope '[data-surface="<name>"]'
 *   bun run design:audit -- --url … --accent '#RRGGBB'      # accent economy check
 *
 * Auth-gated routes (/admin, /dashboard): pass --login <email:password> (or set AUDIT_LOGIN) and the
 * audit signs in through the app's /login form first. Seeded users come from scripts/seed-preview.ts
 * (admin@preview.local, user@preview.local; password Password123!; run `bun run db:seed` first).
 *
 *   bun run design:audit -- --url http://localhost:5231/admin --login 'admin@preview.local:Password123!'
 *
 * Exit code is 0 unless a HARD check fails (horizontal overflow, contrast below AA, motion that
 * ignores prefers-reduced-motion). Everything else reports and lets the human decide — a low
 * shadow count is a fact, not automatically a defect.
 */
import { chromium, type Page } from "playwright";
import {
  clamp,
  channel,
  alphaOf,
  oklchToRgba,
  parseColour,
  composite,
  resolveBackground,
  luminance,
  contrastRatio,
} from "./lib/colour";

interface Args {
  url: string;
  scope: string;
  accent?: string;
  json: boolean;
  login?: { email: string; password: string };
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const url = get("--url");
  if (!url) {
    console.error(
      "usage: bun run design:audit -- --url <url> [--scope <selector>] [--accent <#hex>] [--login <email:password>] [--json]"
    );
    process.exit(2);
  }
  const rawLogin = get("--login") ?? process.env.AUDIT_LOGIN;
  let login: Args["login"];
  if (rawLogin) {
    const at = rawLogin.indexOf(":");
    if (at < 1) {
      console.error("--login expects <email:password>");
      process.exit(2);
    }
    login = { email: rawLogin.slice(0, at), password: rawLogin.slice(at + 1) };
  }
  return {
    login,
    url,
    scope: get("--scope") ?? "body",
    accent: get("--accent"),
    json: argv.includes("--json"),
  };
}

/** Resolve any CSS colour (incl. oklch / colour-mix) to sRGB by letting the compositor paint it. */
const PROBE = `({ scopeSel, accent }) => {
  const scope = document.querySelector(scopeSel) || document.body;
  const els = Array.from(scope.querySelectorAll("*"));

  ${clamp}
  ${channel}
  ${alphaOf}
  ${oklchToRgba}
  ${parseColour}
  ${composite}
  ${resolveBackground}
  ${luminance}
  ${contrastRatio}
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  // Read a CSS colour as [r, g, b, a]. Parse it directly; fall back to painting it on a transparent
  // canvas (never on black, which would turn every translucent colour opaque) for lab, color-mix etc.
  const toRgba = (color) => {
    const parsed = parseColour(color);
    if (parsed) return parsed;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const WHITE = [255, 255, 255, 1];
  // Background an element really shows: its own plus ancestors', composited over the nearest opaque one.
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) layers.push(toRgba(getComputedStyle(n).backgroundColor));
    return resolveBackground(layers, WHITE);
  };
  const ratio = (fg, bg) => contrastRatio(toRgba(fg), bg);
  const isChromatic = (color) => {
    const [r, g, b, a] = toRgba(color);
    return a > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 12;
  };
  const key = (color) => toRgba(color).map((v, i) => (i === 3 ? +v.toFixed(2) : v)).join(",");

  const surfaces = new Map();
  const fonts = new Map();
  const radii = new Map();
  const hues = new Map();
  const sizes = new Map();
  let shadowed = 0;
  let bordered = 0;
  let panels = 0;
  let accentPainted = 0;
  let painted = 0;

  const accentKey = accent ? key(accent) : null;

  for (const el of els) {
    const s = getComputedStyle(el);
    const text = (el.innerText || "").trim();

    const bgA = toRgba(s.backgroundColor)[3];
    if (bgA > 0) surfaces.set(key(s.backgroundColor), (surfaces.get(key(s.backgroundColor)) || 0) + 1);
    if (text) fonts.set(s.fontFamily.split(",")[0].replace(/["']/g, ""), (fonts.get(s.fontFamily.split(",")[0].replace(/["']/g, "")) || 0) + 1);
    if (parseFloat(s.borderTopLeftRadius) > 0) radii.set(s.borderTopLeftRadius, (radii.get(s.borderTopLeftRadius) || 0) + 1);
    if (s.boxShadow !== "none") shadowed++;
    if (parseFloat(s.borderTopWidth) > 0) bordered++;
    if (parseFloat(s.borderTopWidth) > 0 && s.boxShadow !== "none") panels++;

    for (const c of [s.color, s.backgroundColor, s.borderTopColor]) {
      if (isChromatic(c)) hues.set(key(c), (hues.get(key(c)) || 0) + 1);
    }
    if (text) {
      const px = Math.round(parseFloat(s.fontSize));
      sizes.set(px, (sizes.get(px) || 0) + 1);
    }
    if (bgA > 0 || text) painted++;
    if (accentKey && (key(s.backgroundColor) === accentKey || key(s.color) === accentKey)) accentPainted++;
  }

  // Contrast on the pairs that actually matter: body copy, and every button-ish element.
  const bodyEl = scope.querySelector("p") || scope;
  // Elements with no text (an icon-only switch, a checkbox) have no text to read, so skip them.
  const actions = Array.from(scope.querySelectorAll("a,button"))
    .filter((el) => (el.innerText || "").trim())
    .slice(0, 12)
    .map((el) => ({
      label: el.innerText.trim().slice(0, 24),
      ratio: ratio(getComputedStyle(el).color, bgOf(el)),
    }));

  return {
    surfaceLevels: [...surfaces.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) => ({ rgb: c, elements: n })),
    fontFamilies: [...fonts.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => ({ family: f, elements: n })),
    radiiUsed: [...radii.keys()].map((r) => (parseFloat(r) > 999 ? "full" : r)),
    shadowedElements: shadowed,
    borderedElements: bordered,
    panelElements: panels,
    chromaticColours: hues.size,
    accent: accentKey ? { elements: accentPainted, shareOfPainted: +((accentPainted / Math.max(painted, 1)) * 100).toFixed(2) } : null,
    displaySizes: [...sizes.keys()].filter((px) => px >= 28).sort((a, b) => b - a),
    bodyContrast: ratio(getComputedStyle(bodyEl).color, bgOf(bodyEl)),
    actionContrast: actions,
    tables: scope.querySelectorAll("table").length,
    dataRows: scope.querySelectorAll("tbody tr").length,
  };
}`;

async function measure(page: Page, args: Args) {
  // Playwright's evaluate accepts a single argument, so the pair travels as one object.
  return page.evaluate(
    new Function("arg", `return (${PROBE})(arg)`) as (arg: {
      scopeSel: string;
      accent?: string;
    }) => Promise<Record<string, unknown>>,
    { scopeSel: args.scope, accent: args.accent }
  );
}

const args = parseArgs();
const browser = await chromium.launch({ args: ["--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

const jsErrors: string[] = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") jsErrors.push(m.text());
});

if (args.login) {
  const loginUrl = new URL("/login", args.url).toString();
  await page.goto(loginUrl, { waitUntil: "networkidle" });
  await page.getByTestId("login-email").fill(args.login.email);
  await page.getByTestId("login-password").fill(args.login.password);
  await page.getByTestId("login-submit").click();
  const left = await page
    .waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 10_000 })
    .then(() => true, () => false);
  if (!left) {
    console.error(`login as ${args.login.email} did not leave /login: wrong credentials or unseeded DB?`);
    await browser.close();
    process.exit(2);
  }
  jsErrors.length = 0; // errors from the login page are not findings on the audited page
}

await page.goto(args.url, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

const desktop = (await measure(page, args)) as Record<string, any>;

const overflow = async () =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
const overflowDesktop = await overflow();

// Motion: does anything animate, and does it stop when asked?
const animatedDefault = await page.evaluate(
  (sel) =>
    Array.from((document.querySelector(sel) || document.body).querySelectorAll("*")).filter(
      (el) => getComputedStyle(el).animationName !== "none"
    ).length,
  args.scope
);
await page.emulateMedia({ reducedMotion: "reduce" });
await page.reload({ waitUntil: "networkidle" });
const animatedReduced = await page.evaluate(
  (sel) =>
    Array.from((document.querySelector(sel) || document.body).querySelectorAll("*")).filter(
      (el) => getComputedStyle(el).animationName !== "none"
    ).length,
  args.scope
);
await page.emulateMedia({ reducedMotion: "no-preference" });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(args.url, { waitUntil: "networkidle" });
const overflowMobile = await overflow();

await browser.close();

const report = {
  url: args.url,
  scope: args.scope,
  desktop,
  motion: { animatedElements: animatedDefault, underReducedMotion: animatedReduced },
  overflow: { desktop: overflowDesktop, mobile: overflowMobile },
  jsErrors,
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// ---- human summary -----------------------------------------------------------------------------
const hard: string[] = [];
const notes: string[] = [];

const line = (label: string, value: string) => `  ${label.padEnd(26)} ${value}`;

console.log(`\n=== design audit — ${args.url} (${args.scope}) ===\n`);
console.log(line("surface levels", String(desktop.surfaceLevels.length)));
console.log(
  line(
    "type faces",
    desktop.fontFamilies.map((f: any) => `${f.family}(${f.elements})`).join(" · ") || "none"
  )
);
console.log(line("display sizes ≥28px", desktop.displaySizes.join(", ") || "none"));
console.log(line("radii", desktop.radiiUsed.join(", ") || "0 (square)"));
console.log(line("shadowed / bordered", `${desktop.shadowedElements} / ${desktop.borderedElements}`));
console.log(line("panels (border+shadow)", String(desktop.panelElements)));
console.log(line("chromatic colours", String(desktop.chromaticColours)));
if (desktop.accent)
  console.log(
    line("accent economy", `${desktop.accent.elements} elements (${desktop.accent.shareOfPainted}% of painted)`)
  );
console.log(line("product data rows", `${desktop.dataRows} in ${desktop.tables} table(s)`));
console.log(line("body contrast", `${desktop.bodyContrast}:1`));
console.log(
  line("motion", `${animatedDefault} animated → ${animatedReduced} under reduced-motion`)
);
console.log(
  line("overflow", `desktop ${overflowDesktop.scrollWidth}/${overflowDesktop.clientWidth} · mobile ${overflowMobile.scrollWidth}/${overflowMobile.clientWidth}`)
);

// HARD checks — these are defects, not opinions.
if (overflowMobile.scrollWidth > overflowMobile.clientWidth)
  hard.push(`horizontal page scroll at 390px (${overflowMobile.scrollWidth} > ${overflowMobile.clientWidth})`);
if (overflowDesktop.scrollWidth > overflowDesktop.clientWidth)
  hard.push("horizontal page scroll at 1440px");
if (desktop.bodyContrast < 4.5) hard.push(`body copy contrast ${desktop.bodyContrast}:1 is below AA`);
for (const a of desktop.actionContrast as any[])
  if (a.ratio < 4.5) hard.push(`action "${a.label}" contrast ${a.ratio}:1 is below AA`);
if (animatedDefault > 0 && animatedReduced === animatedDefault)
  hard.push("animation ignores prefers-reduced-motion");
if (jsErrors.length) hard.push(`${jsErrors.length} console/page error(s)`);

// SOFT notes — the craft signals five rejected passes of /demo all failed on.
if (desktop.fontFamilies.length < 2)
  notes.push("one type face only — a display/data pairing is most of the distance from a framework default");
if (desktop.displaySizes.length < 2)
  notes.push("no second display size — the page has one typographic register and will flatten below the fold");
if (desktop.panelElements === 0 && desktop.shadowedElements === 0)
  notes.push("no raised surfaces — deliberate for a flat direction, absent craft otherwise");
if (desktop.dataRows === 0)
  notes.push("no product data on the page — for software marketing, show the product");
if (animatedDefault === 0)
  notes.push("nothing moves — if the subject changes over time, consider whether it should");
if (desktop.accent && desktop.accent.shareOfPainted > 4)
  notes.push(`accent paints ${desktop.accent.shareOfPainted}% of elements — an accent spent everywhere is decoration`);
if (desktop.chromaticColours > 4)
  notes.push(`${desktop.chromaticColours} chromatic colours — check each one earns its place`);

console.log("");
if (hard.length) {
  console.log("HARD FAILURES");
  for (const h of hard) console.log(`  ✗ ${h}`);
} else {
  console.log("HARD CHECKS: pass (no overflow, contrast ≥ AA, motion respects reduced-motion, no console errors)");
}
if (notes.length) {
  console.log("\nCRAFT NOTES (judgement, not verdicts)");
  for (const n of notes) console.log(`  · ${n}`);
}
console.log("");

process.exit(hard.length ? 1 : 0);
