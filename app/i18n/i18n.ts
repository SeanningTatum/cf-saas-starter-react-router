import { createCookie } from "react-router";
import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  localeCookieName,
  namespaces,
  supportedLngs,
} from "@/lib/constants/i18n";

export {
  supportedLngs,
  fallbackLng,
  defaultNS,
  namespaces,
  localeCookieName,
} from "@/lib/constants/i18n";

export type SupportedLocale = (typeof supportedLngs)[number];
export type Namespace = (typeof namespaces)[number];

export const localeCookie = createCookie(localeCookieName, {
  path: "/",
  sameSite: "lax",
  maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
});
