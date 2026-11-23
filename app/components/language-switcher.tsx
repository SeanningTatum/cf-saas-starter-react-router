import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { supportedLngs } from "@/lib/constants/i18n";
import { cn } from "@/lib/utils";
import { API_ROUTES } from "@/lib/constants/routes";
import { LANGUAGE_LABELS } from "@/lib/constants/i18n";

interface LanguageSwitcherProps {
  className?: string;
  compact?: boolean;
}

export function LanguageSwitcher({ className, compact = false }: LanguageSwitcherProps = {}) {
  const { i18n } = useTranslation();
  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";

  function handleLanguageChange(newLng: string) {
    if (newLng === i18n.language || pending) return;
    fetcher.submit({ lng: newLng }, { method: "post", action: API_ROUTES.setLocale });
  }

  return (
    <Select value={i18n.language} onValueChange={handleLanguageChange} disabled={pending}>
      <SelectTrigger
        className={cn(compact ? "h-8 w-auto gap-1 px-2 text-xs" : "w-[140px]", className)}
        data-testid="language-switcher"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {supportedLngs.map((lng) => (
          <SelectItem key={lng} value={lng}>
            {LANGUAGE_LABELS[lng] ?? lng}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
