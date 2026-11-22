import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Link, useNavigate } from "react-router"
import { authClient } from "@/auth/client"
import { effectResolver } from "@/lib/effect-form"
import { useForm } from "react-hook-form"
import { LoginSchema, type LoginInput } from "@/lib/schemas/auth"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useHydrated } from "@/hooks/use-hydrated"
import { ProblemBox, TurnstileWidget, useTurnstile } from "@/components/turnstile-widget"
import { captchaFetchOptions } from "@/lib/turnstile-client"
import { authRefusalFor } from "@/lib/auth-errors"
import { ROUTES } from "@/lib/constants/routes"

interface LoginFormProps extends React.ComponentProps<"div"> {
  turnstileSiteKey?: string | null
}

export function LoginForm({ className, turnstileSiteKey = null, ...props }: LoginFormProps) {
  const navigate = useNavigate()
  const [authError, setAuthError] = useState<string>()
  const { t } = useTranslation("auth")
  const hydrated = useHydrated()
  const turnstile = useTurnstile(turnstileSiteKey)
  const awaitingCheck = turnstile.enabled && turnstile.token === null

  const form = useForm<LoginInput>({
    resolver: effectResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  async function onSubmit(data: LoginInput) {
    setAuthError(undefined)
    if (awaitingCheck) return

    try {
      const result = await authClient.signIn.email({
        email: data.email,
        password: data.password,
        fetchOptions: captchaFetchOptions(turnstile.token),
      })

      if (result.error) {
        turnstile.reset()
        const refusal = authRefusalFor(result.error, turnstile.enabled)
        setAuthError(refusal ? t(`refusal.${refusal}`) : result.error.message || t("login.error_invalid"))
        return
      }

      navigate(ROUTES.dashboard)
    } catch (err) {
      turnstile.reset()
      setAuthError(err instanceof Error ? err.message : t("login.error_failed"))
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card data-testid="login-card" className="border-border/80 shadow-sm">
        <CardHeader className="gap-2 px-4 sm:px-6">
          <CardTitle className="text-xl">{t("login.title")}</CardTitle>
          <CardDescription>{t("login.description")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <Form {...form}>
            <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="login-form">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("login.email_label")}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder={t("login.email_placeholder")}
                        data-testid="login-email"
                        {...field}
                        disabled={form.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>{t("login.password_label")}</FormLabel>
                      <a
                        href="#"
                        className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                      >
                        {t("login.forgot_password")}
                      </a>
                    </div>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        data-testid="login-password"
                        {...field}
                        disabled={form.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {turnstile.enabled && <TurnstileWidget turnstile={turnstile} />}
              {authError && (
                <ProblemBox role="alert" data-testid="login-error">
                  <p>{authError}</p>
                </ProblemBox>
              )}
              <div className="space-y-4">
                <Button
                  type="submit"
                  className="w-full"
                  data-testid="login-submit"
                  disabled={!hydrated || form.formState.isSubmitting || awaitingCheck}
                >
                  {form.formState.isSubmitting ? t("login.submitting") : t("login.submit")}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  {t("login.no_account")}{" "}
                  <Link to={ROUTES.signUp} className="underline underline-offset-4">
                    {t("login.sign_up_link")}
                  </Link>
                </p>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
