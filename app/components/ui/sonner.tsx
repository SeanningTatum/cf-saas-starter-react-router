import { useEffect, type CSSProperties } from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { takeHeldSuccessToast } from "@/lib/held-toast";
import { toast as sonnerToast, Toaster as Sonner, type ToasterProps } from "sonner";

const ERROR_TOAST_DURATION_MS = Number.POSITIVE_INFINITY;

const toast: typeof sonnerToast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  sonnerToast,
  {
    error: (...[message, data]: Parameters<typeof sonnerToast.error>) =>
      sonnerToast.error(message, { duration: ERROR_TOAST_DURATION_MS, ...data }),
  },
);

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

  useEffect(() => {
    const held = takeHeldSuccessToast(() => window.sessionStorage);
    if (held !== null) sonnerToast.success(held);
  }, []);

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
      closeButton
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
        closeButtonAriaLabel: t("close_notification"),
        classNames: {
          toast:
            "pe-12! focus-visible:shadow-md focus-visible:ring-3! focus-visible:ring-muted-foreground",
          closeButton:
            "start-auto! end-2! top-1/2! size-8! -translate-y-1/2! transform-none! rounded-md! border-0! bg-transparent! text-muted-foreground! hover:bg-muted! hover:text-foreground! focus-visible:ring-3! focus-visible:ring-ring/50! [&>svg]:size-4",
        },
      }}
      {...props}
    />
  );
}

export { ERROR_TOAST_DURATION_MS, Toaster, toast };
