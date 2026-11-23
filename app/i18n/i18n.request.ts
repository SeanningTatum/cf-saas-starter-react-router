import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { supportedLngs, fallbackLng, defaultNS, i18nInterpolation } from "@/lib/constants/i18n";

export const createRequestI18n = async (lng: string, ns: string[]) => {
  const instance = createInstance();
  await instance
    .use(initReactI18next)
    .use(
      resourcesToBackend(
        (language: string, namespace: string) => import(`../locales/${language}/${namespace}.json`),
      ),
    )
    .init({
      supportedLngs: [...supportedLngs],
      fallbackLng,
      defaultNS,
      interpolation: i18nInterpolation,
      lng,
      ns,
    });
  return instance;
};
