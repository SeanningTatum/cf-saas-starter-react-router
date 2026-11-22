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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Link, useNavigate } from "react-router"
import { authClient } from "@/auth/client"
import { effectTsResolver as effectResolver } from "@hookform/resolvers/effect-ts"
import { useForm } from "react-hook-form"
import { SignupSchema, type SignupInput } from "@/lib/schemas/auth"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useHydrated } from "@/hooks/use-hydrated"
import { ProblemBox, TurnstileWidget, useTurnstile } from "@/components/turnstile-widget"
import { captchaFetchOptions } from "@/lib/turnstile-client"
import { authRefusalFor } from "@/lib/auth-errors"
import { ROUTES } from "@/lib/constants/routes"

interface SignupFormProps extends React.ComponentProps<"div"> {
  turnstileSiteKey?: string | null
}

export function SignupForm({ className, turnstileSiteKey = null, ...props }: SignupFormProps) {
  const navigate = useNavigate()
  const [authError, setAuthError] = useState<string>()
  const { t } = useTranslation("auth")
  const hydrated = useHydrated()
  const turnstile = useTurnstile(turnstileSiteKey)
  const awaitingCheck = turnstile.enabled && turnstile.token === null

  const form = useForm<SignupInput>({
    resolver: effectResolver(SignupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  async function onSubmit(data: SignupInput) {
    setAuthError(undefined)
    if (awaitingCheck) return

    try {
      const result = await authClient.signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
        fetchOptions: captchaFetchOptions(turnstile.token),
      })

      if (result.error) {
        turnstile.reset()
        const refusal = authRefusalFor(result.error, turnstile.enabled)
        setAuthError(refusal ? t(`refusal.${refusal}`) : result.error.message || t("signup.error_failed"))
        return
      }

      navigate(ROUTES.dashboard)
    } catch (err) {
      turnstile.reset()
      setAuthError(err instanceof Error ? err.message : t("signup.error_failed"))
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card data-testid="signup-card" className="border-border/80 shadow-sm">
        <CardHeader className="gap-2 px-4 sm:px-6">
          <CardTitle className="text-xl">{t("signup.title")}</CardTitle>
          <CardDescription>{t("signup.description")}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <Form {...form}>
            <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="signup-form">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("signup.name_label")}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="name"
                        placeholder={t("signup.name_placeholder")}
                        data-testid="signup-name"
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
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("signup.email_label")}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder={t("signup.email_placeholder")}
                        data-testid="signup-email"
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
                    <FormLabel>{t("signup.password_label")}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        data-testid="signup-password"
                        {...field}
                        disabled={form.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormDescription>{t("signup.password_hint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("signup.confirm_password_label")}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        data-testid="signup-confirm-password"
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
                <ProblemBox role="alert" data-testid="signup-error">
                  <p>{authError}</p>
                </ProblemBox>
              )}
              <div className="space-y-4">
                <Button
                  type="submit"
                  className="w-full"
                  data-testid="signup-submit"
                  disabled={!hydrated || form.formState.isSubmitting || awaitingCheck}
                >
                  {form.formState.isSubmitting ? t("signup.submitting") : t("signup.submit")}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  {t("signup.has_account")}{" "}
                  <Link to={ROUTES.login} className="underline underline-offset-4">
                    {t("signup.login_link")}
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
