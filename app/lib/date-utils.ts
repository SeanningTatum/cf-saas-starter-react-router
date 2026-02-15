import { format, type Locale } from "date-fns";
import { enUS } from "date-fns/locale";

const localeMap: Record<string, Locale> = {
  en: enUS,
};

export function getDateFnsLocale(i18nLocale: string): Locale {
  return localeMap[i18nLocale] ?? enUS;
}

export function formatDate(
  date: Date | number,
  formatStr: string,
  i18nLocale: string
): string {
  return format(date, formatStr, { locale: getDateFnsLocale(i18nLocale) });
}
