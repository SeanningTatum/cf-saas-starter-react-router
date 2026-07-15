import { format, type Locale } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";

const localeMap: Record<string, Locale> = {
  en: enUS,
  zh: zhCN,
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
