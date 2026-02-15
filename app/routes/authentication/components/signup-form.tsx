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
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { useState } from "react"
import { useTranslation } from "react-i18next"

interface SignupFormProps extends React.ComponentProps<"div"> { }

const signupSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export function SignupForm({ className, ...props }: SignupFormProps) {
  const navigate = useNavigate()
  const [authError, setAuthError] = useState<string>()
  const { t } = useTranslation("auth")

  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  async function onSubmit(data: z.infer<typeof signupSchema>) {
    setAuthError(undefined)

    try {
      const result = await authClient.signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
      })

      if (result.error) {
        setAuthError(result.error.message || t("signup.error_failed"))
        return
      }

      navigate("/dashboard")
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : t("signup.error_failed"))
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>{t("signup.title")}</CardTitle>
          <CardDescription>
            {t("signup.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("signup.name_label")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("signup.name_placeholder")}
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
                        placeholder={t("signup.email_placeholder")}
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
                        {...field}
                        disabled={form.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("signup.password_hint")}
                    </FormDescription>
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
                        {...field}
                        disabled={form.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {authError && (
                <div className="text-sm text-red-600 text-center">
                  {authError}
                </div>
              )}
              <div className="space-y-4">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? t("signup.submitting") : t("signup.submit")}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  {t("signup.has_account")}{" "}
                  <Link to="/login" className="underline underline-offset-4">
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
