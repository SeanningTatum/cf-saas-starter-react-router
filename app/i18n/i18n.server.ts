import { RemixI18Next } from "remix-i18next/server";
import {
  supportedLngs,
  fallbackLng,
  defaultNS,
  localeCookieName,
} from "./i18n";
import resourcesToBackend from "i18next-resources-to-backend";

export const i18nServer = new RemixI18Next({
  detection: {
    supportedLanguages: [...supportedLngs],
    fallbackLanguage: fallbackLng,
    cookie: { name: localeCookieName },
  },
  i18next: {
    defaultNS,
    supportedLngs: [...supportedLngs],
    fallbackLng,
  },
  plugins: [
    resourcesToBackend(
      (language: string, namespace: string) =>
        import(`../locales/${language}/${namespace}.json`)
    ),
  ],
});

export async function getLocale(request: Request): Promise<string> {
  return i18nServer.getLocale(request);
}
