import { data } from "react-router";
import { createCookie } from "react-router";
import { localeCookieName, supportedLngs } from "@/i18n";
import type { Route } from "./+types/set-locale";

const localeCookie = createCookie(localeCookieName, {
  path: "/",
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 365,
});

/**
 * Persist the user's locale choice in the i18n cookie. The cookie format is
 * owned by `createCookie` (base64-encoded JSON), so all writes go through
 * `localeCookie.serialize` rather than `document.cookie` to keep the encoding
 * in lockstep with the server-side reader in `i18n.server.ts`.
 *
 * Client flow: POST { lng } → server sets cookie → client also calls
 * `i18n.changeLanguage(lng)` for an instant in-page swap (no reload).
 */
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const lng = formData.get("lng");

  if (typeof lng !== "string" || !supportedLngs.includes(lng as (typeof supportedLngs)[number])) {
    return data({ ok: false, error: "unsupported_locale" }, { status: 400 });
  }

  return data(
    { ok: true, lng },
    {
      headers: {
        "Set-Cookie": await localeCookie.serialize(lng),
      },
    },
  );
}
