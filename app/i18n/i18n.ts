export const supportedLngs = ["en"] as const;
export const fallbackLng = "en" as const;
export const defaultNS = "common" as const;
export const namespaces = [
  "common",
  "auth",
  "admin",
  "dashboard",
  "home",
  "validation",
] as const;

export const localeCookieName = "i18next";

export type SupportedLocale = (typeof supportedLngs)[number];
export type Namespace = (typeof namespaces)[number];
