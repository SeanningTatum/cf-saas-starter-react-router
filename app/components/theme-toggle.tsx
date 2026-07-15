import { Moon, Sun, Monitor } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Single source of truth for the light/dark/system options — shared by this
 * standalone toggle and the theme submenu in `nav-user.tsx` so both list the
 * same choices with the same icons. `value` doubles as the i18n key suffix
 * under `common.json`'s `theme` namespace (`theme.light` / `theme.dark` /
 * `theme.system`) — render sites call `t(`theme.${value}`)` rather than a
 * hardcoded label here.
 */
export const themeItems: ReadonlyArray<{
  value: "light" | "dark" | "system"
  icon: LucideIcon
}> = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
]

export function ThemeToggle() {
  const { setTheme } = useTheme()
  const { t } = useTranslation("common")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t("theme.toggle_label")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themeItems.map(({ value, icon: Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon className="h-4 w-4" />
            {t(`theme.${value}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
