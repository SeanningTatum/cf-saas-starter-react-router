import { LoginForm } from "./components/login-form"
import { useTranslation } from "react-i18next"

export const handle = { i18n: ["auth"] };

export default function Login() {
  const { t } = useTranslation("common")

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="/" className="flex items-center gap-2 self-center font-medium">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-xs font-bold">{t("app_name_short")}</span>
          </div>
          {t("app_name")}
        </a>
        <LoginForm />
      </div>
    </div>
  )
}
