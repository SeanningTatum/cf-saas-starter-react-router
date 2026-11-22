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

const SECONDS_PER_YEAR = 60 * 60 * 24 * 365;
export const LOCALE_COOKIE_MAX_AGE_SECONDS = SECONDS_PER_YEAR;

export const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  zh: "中文",
};
