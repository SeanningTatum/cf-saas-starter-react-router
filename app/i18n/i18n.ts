import { createCookie } from "react-router";
import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  localeCookieName,
} from "@/lib/constants/i18n";

export const localeCookie = createCookie(localeCookieName, {
  path: "/",
  sameSite: "lax",
  maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
});
