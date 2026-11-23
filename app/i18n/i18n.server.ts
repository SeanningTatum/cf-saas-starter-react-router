import { RemixI18Next } from "remix-i18next/server";
import { supportedLngs, fallbackLng, defaultNS, i18nInterpolation } from "@/lib/constants/i18n";
import { localeCookie } from "./i18n";
import resourcesToBackend from "i18next-resources-to-backend";

export const i18nServer = new RemixI18Next({
  detection: {
    supportedLanguages: [...supportedLngs],
    fallbackLanguage: fallbackLng,
    cookie: localeCookie,
  },
  i18next: {
    defaultNS,
    interpolation: i18nInterpolation,
    supportedLngs: [...supportedLngs],
    fallbackLng,
  },
  plugins: [
    resourcesToBackend(
      (language: string, namespace: string) => import(`../locales/${language}/${namespace}.json`),
    ),
  ],
});
