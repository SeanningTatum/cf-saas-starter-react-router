import { data } from "react-router";
import { localeCookie } from "@/i18n/i18n";
import { supportedLngs } from "@/lib/constants/i18n";
import type { Route } from "./+types/set-locale";

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
