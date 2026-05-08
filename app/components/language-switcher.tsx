import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { supportedLngs } from "@/i18n";
import { cn } from "@/lib/utils";

const languageLabels: Record<string, string> = {
  en: "English",
  zh: "中文",
};

interface LanguageSwitcherProps {
  className?: string;
  /** Compact pill suitable for top bars. Defaults to false (wide select). */
  compact?: boolean;
}

/**
 * Locale toggle. SSR detects locale via cookie/header in
 * `app/i18n/i18n.server.ts`; this component drives the swap by submitting
 * to the `/api/set-locale` action via `useFetcher`. That:
 *   1. Sets the persistent locale cookie (server-owned encoding — see
 *      `app/routes/api/set-locale.ts`) so future SSR requests honor it.
 *   2. Triggers React Router's automatic loader revalidation, so the root
 *      loader re-detects locale and `useChangeLanguage(loaderData.locale)`
 *      in `app/root.tsx` flips the live i18next instance.
 *
 * No full reload, no manual `i18n.changeLanguage` call — relying on the
 * existing root-level binding keeps the component idempotent and avoids
 * fighting with `useChangeLanguage`'s revert-on-mismatch effect.
 */
export function LanguageSwitcher({
  className,
  compact = false,
}: LanguageSwitcherProps = {}) {
  const { i18n } = useTranslation();
  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";

  function handleLanguageChange(newLng: string) {
    if (newLng === i18n.language || pending) return;
    fetcher.submit(
      { lng: newLng },
      { method: "post", action: "/api/set-locale" },
    );
  }

  return (
    <Select value={i18n.language} onValueChange={handleLanguageChange} disabled={pending}>
      <SelectTrigger
        className={cn(
          compact ? "h-8 w-auto gap-1 px-2 text-xs" : "w-[140px]",
          className,
        )}
        data-testid="language-switcher"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {supportedLngs.map((lng) => (
          <SelectItem key={lng} value={lng}>
            {languageLabels[lng] ?? lng}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
