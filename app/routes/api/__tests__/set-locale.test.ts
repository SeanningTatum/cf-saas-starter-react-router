import { describe, expect, it } from "vitest";
import { localeCookie } from "@/i18n/i18n";
import { supportedLngs } from "@/lib/constants/i18n";
import { API_ROUTES } from "@/lib/constants/routes";
import { action } from "../set-locale";

type ActionArgs = Parameters<typeof action>[0];

const endpoint = `https://app.example.com${API_ROUTES.setLocale}`;

const send = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request(endpoint, { method: "POST", body });
  return action({ request, context: {}, params: {} } as unknown as ActionArgs);
};

const headerOf = (init: ResponseInit | null | undefined, name: string) =>
  new Headers(init?.headers).get(name);

describe("/api/set-locale", () => {
  it.each(supportedLngs)(
    "answers ok and sets a cookie that reads back as %s, so that a switch to a supported language survives the next request",
    async (lng) => {
      const result = await send({ lng });
      expect(result.data).toEqual({ ok: true, lng });
      expect(result.init?.status ?? 200).toBe(200);
      const cookie = headerOf(result.init, "Set-Cookie");
      expect(cookie).not.toBeNull();
      expect(await localeCookie.parse(cookie)).toBe(lng);
    },
  );

  it("answers 400 unsupported_locale with no cookie for a language outside supportedLngs, so that a forged value never lands in the locale cookie", async () => {
    const result = await send({ lng: "xx" });
    expect(result.init?.status).toBe(400);
    expect(result.data).toEqual({ ok: false, error: "unsupported_locale" });
    expect(headerOf(result.init, "Set-Cookie")).toBeNull();
  });

  it("answers 400 unsupported_locale when the lng field is missing, so that an empty form cannot clear or corrupt the locale", async () => {
    const result = await send({ language: supportedLngs[0] });
    expect(result.init?.status).toBe(400);
    expect(result.data).toEqual({ ok: false, error: "unsupported_locale" });
    expect(headerOf(result.init, "Set-Cookie")).toBeNull();
  });
});
