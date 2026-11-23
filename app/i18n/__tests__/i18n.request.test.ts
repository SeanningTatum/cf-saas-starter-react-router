import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRequestI18n } from "../i18n.request";
import { i18nServer } from "../i18n.server";
import { i18nInterpolation, supportedLngs } from "@/lib/constants/i18n";

const NAME = "O'Brien & Co";

describe("interpolated user data", () => {
  it("pins escapeValue off in the shared setting", () => {
    expect(i18nInterpolation.escapeValue).toBe(false);
  });

  it.each(supportedLngs)("renders the %s dashboard welcome with the name as typed", async (lng) => {
    const instance = await createRequestI18n(lng, ["dashboard"]);

    const text = instance.t("welcome", { ns: "dashboard", name: NAME });

    expect(text).toContain(NAME);
    expect(text).not.toMatch(/&#|&amp;|&quot;/);
  });

  it.each(supportedLngs)("renders the %s admin ban toast with the name as typed", async (lng) => {
    const instance = await createRequestI18n(lng, ["admin"]);

    const text = instance.t("users_table.toasts.ban_success", { ns: "admin", name: NAME });

    expect(text).toContain(NAME);
  });

  it.each(supportedLngs)("renders the %s upload line with a path as typed", async (lng) => {
    const instance = await createRequestI18n(lng, ["upload"]);

    const text = instance.t("key_label", { ns: "upload", key: "uploads/abc.png" });

    expect(text).toContain("uploads/abc.png");
  });

  it.each(supportedLngs)("renders loader text in %s with the name as typed", async (lng) => {
    const t = await i18nServer.getFixedT(lng, "dashboard");

    expect(t("welcome", { name: NAME })).toContain(NAME);
  });

  it("sets the same option in the browser setup", () => {
    const source = readFileSync(path.resolve(__dirname, "../i18n.client.ts"), "utf8");

    expect(source).toContain("interpolation: i18nInterpolation");
  });
});
