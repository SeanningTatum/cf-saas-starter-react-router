import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router";
import { supportedLngs } from "@/i18n";

const languageLabels: Record<string, string> = {
  en: "English",
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  function handleLanguageChange(newLng: string) {
    // Remove existing locale prefix from pathname
    const pathSegments = location.pathname.split("/").filter(Boolean);
    const currentLng = supportedLngs.find((lng) => pathSegments[0] === lng);

    let newPath: string;
    if (currentLng) {
      // Replace the existing locale prefix
      pathSegments[0] = newLng;
      newPath = "/" + pathSegments.join("/");
    } else {
      // Add locale prefix
      newPath = `/${newLng}${location.pathname}`;
    }

    navigate(newPath + location.search);
  }

  return (
    <Select
      value={i18n.language}
      onValueChange={handleLanguageChange}
    >
      <SelectTrigger className="w-[140px]" data-testid="language-switcher">
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
