import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  IconArrowLeft,
  IconShieldLock,
  IconLockSquareRounded,
  IconDatabase,
  IconCloud,
} from "@tabler/icons-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { StackBadge } from "@/components/stack-badge";

interface AuthShellProps {
  /** Form column content (the sign-in / sign-up card). */
  children: React.ReactNode;
}

/**
 * Split-pane shell for the auth pages. Form on the left (always visible), an
 * educational context panel on the right (md+ only) so engineers evaluating
 * the boilerplate immediately see what's powering the auth flow.
 */
export function AuthShell({ children }: AuthShellProps) {
  const { t } = useTranslation("auth");
  const { t: tc } = useTranslation("common");

  return (
    <div className="grid min-h-svh grid-cols-1 md:grid-cols-[5fr_7fr]">
      {/* Form column */}
      <div className="relative flex flex-col px-6 py-8 md:px-10">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            data-testid="auth-back-home"
          >
            <IconArrowLeft className="size-4" />
            {t("shell.back_home")}
          </Link>
          <div className="flex items-center gap-1">
            <LanguageSwitcher compact />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-sm flex-col gap-8">
            <Link
              to="/"
              className="flex items-center gap-2 self-start text-sm font-medium"
            >
              <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-[10px] font-bold">
                {tc("app_name_short")}
              </span>
              {tc("app_name")}
            </Link>
            {children}
          </div>
        </div>
      </div>

      {/* Context column */}
      <aside
        aria-hidden="true"
        className="relative hidden flex-col justify-between border-l border-border bg-muted/30 p-12 md:flex"
      >
        <div className="absolute inset-0 -z-0 bg-[radial-gradient(circle_at_top_right,_var(--color-muted),_transparent_60%)]" />
        <div className="relative z-10 flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" />
              {t("shell.eyebrow")}
            </span>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("shell.heading")}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t("shell.description")}
            </p>
          </div>

          <ul className="flex flex-col gap-4">
            <ContextRow
              icon={<IconShieldLock className="size-5" />}
              title={t("shell.points.session.title")}
              body={t("shell.points.session.body")}
            />
            <ContextRow
              icon={<IconLockSquareRounded className="size-5" />}
              title={t("shell.points.password.title")}
              body={t("shell.points.password.body")}
            />
            <ContextRow
              icon={<IconDatabase className="size-5" />}
              title={t("shell.points.storage.title")}
              body={t("shell.points.storage.body")}
            />
            <ContextRow
              icon={<IconCloud className="size-5" />}
              title={t("shell.points.runtime.title")}
              body={t("shell.points.runtime.body")}
            />
          </ul>
        </div>

        <div className="relative z-10 flex flex-wrap gap-2">
          {["Better Auth", "Drizzle", "D1", "Workers", "Effect TS"].map((s) => (
            <StackBadge key={s}>{s}</StackBadge>
          ))}
        </div>
      </aside>
    </div>
  );
}

function ContextRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-4">
      <span className="mt-0.5 flex size-9 items-center justify-center rounded-md border border-border bg-card text-foreground">
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}
