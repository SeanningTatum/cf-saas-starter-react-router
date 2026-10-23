import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LOCALES_DIR = path.resolve(__dirname, "..");
const HOME_ROUTE = path.resolve(__dirname, "../../routes/home.tsx");

const readNamespace = (lng: string, ns: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, lng, `${ns}.json`), "utf8"));

// Dotted paths of every string leaf, e.g. "harness.pillars.skills.title".
const leafKeys = (obj: Record<string, unknown>, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object"
      ? leafKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );

const namespaces = fs
  .readdirSync(path.join(LOCALES_DIR, "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

describe("locale parity (en ↔ zh)", () => {
  it.each(namespaces)("%s has the same keys in en and zh", (ns) => {
    const en = leafKeys(readNamespace("en", ns)).sort();
    const zh = leafKeys(readNamespace("zh", ns)).sort();
    expect(zh).toEqual(en);
  });
});

describe("home route i18n keys", () => {
  // Catches a renamed key (e.g. harness.pillars.recipes → skills) that the
  // route still references, which renders the raw key on the landing page.
  const usedKeys = [
    ...fs.readFileSync(HOME_ROUTE, "utf8").matchAll(/\bt\("([a-z0-9_.]+)"/gi),
  ].map((m) => m[1]);

  it("references at least the harness pillars", () => {
    expect(usedKeys).toEqual(
      expect.arrayContaining([
        "harness.pillars.brain.title",
        "harness.pillars.skills.title",
        "harness.pillars.gates.title",
      ])
    );
  });

  it.each(["en", "zh"])("every t() key in home.tsx exists in %s/home.json", (lng) => {
    const keys = new Set(leafKeys(readNamespace(lng, "home")));
    expect(usedKeys.filter((k) => !keys.has(k))).toEqual([]);
  });
});
