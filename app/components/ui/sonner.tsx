import type { CSSProperties } from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner, type ToasterProps } from "sonner";

type SonnerTokenStyle = CSSProperties & Record<`--${string}`, string>;

function toSonnerTheme(resolvedTheme: string | undefined): ToasterProps["theme"] {
  if (resolvedTheme === "dark" || resolvedTheme === "light") {
    return resolvedTheme;
  }
  return "system";
}

function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation("common");

  const tokenStyle: SonnerTokenStyle = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
    fontFamily: "var(--font-sans)",
  };

  return (
    <Sonner
      theme={toSonnerTheme(resolvedTheme)}
      className="toaster group"
      containerAriaLabel={t("notifications_region")}
      icons={{
        success: <CircleCheckIcon className="size-4" aria-hidden />,
        info: <InfoIcon className="size-4" aria-hidden />,
        warning: <TriangleAlertIcon className="size-4" aria-hidden />,
        error: <OctagonXIcon className="size-4 text-destructive" aria-hidden />,
        loading: (
          <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ),
      }}
      style={tokenStyle}
      toastOptions={{
        classNames: {
          toast:
            "focus-visible:shadow-md focus-visible:ring-3! focus-visible:ring-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
