import { createCookie } from "react-router";

export const supportedLngs = ["en", "zh"] as const;
export const fallbackLng = "en" as const;
export const defaultNS = "common" as const;
export const namespaces = [
  "common",
  "auth",
  "admin",
  "dashboard",
  "home",
  "validation",
  "upload",
] as const;

export const localeCookieName = "i18next";

export type SupportedLocale = (typeof supportedLngs)[number];
export type Namespace = (typeof namespaces)[number];

/**
 * Single source of truth for the i18n locale cookie config, shared by the
 * server-side detector (`i18n.server.ts`) and the client-side setter
 * (`routes/api/set-locale.ts`) so both read/write the exact same cookie shape.
 */
export const localeCookie = createCookie(localeCookieName, {
  path: "/",
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 365, // 1 year
});
