import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import resourcesToBackend from "i18next-resources-to-backend";
import { getInitialNamespaces } from "remix-i18next/client";
import { supportedLngs, fallbackLng, defaultNS } from "./i18n";

await i18next
  .use(initReactI18next)
  .use(LanguageDetector)
  .use(
    resourcesToBackend(
      (language: string, namespace: string) =>
        import(`../locales/${language}/${namespace}.json`)
    )
  )
  .init({
    supportedLngs: [...supportedLngs],
    fallbackLng,
    defaultNS,
    ns: getInitialNamespaces(),
    detection: {
      order: ["htmlTag"],
      caches: [],
    },
  });

export default i18next;
