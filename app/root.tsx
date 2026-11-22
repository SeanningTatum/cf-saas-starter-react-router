import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import { ThemeProvider } from "next-themes";

import type { Route } from "./+types/root";
import "./app.css";
import { TRPCProvider } from "./trpc/client";
import { useTranslation } from "react-i18next";
import { useChangeLanguage } from "remix-i18next/react";
import { i18nServer } from "./i18n/i18n.server";
import { useNonce } from "./lib/csp-nonce";
import { useDocumentRequestId } from "./lib/request-id";
import { useReportBoundaryError } from "./lib/error-reporting/browser";

export const handle = { i18n: ["common"] };

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const locale = await i18nServer.getLocale(request);
  return { locale, requestId: context.requestId };
}

/**
 * The id to show a user who reports a problem. Loader data is the freshest
 * source (the root loader runs again on each navigation), but React Router
 * skips the root loader on a 404 or 405, so fall back to the id of the
 * request that rendered the document.
 */
const useRequestId = () => {
  const fromLoader = useRouteLoaderData<typeof loader>("root")?.requestId;
  const fromDocument = useDocumentRequestId();
  return fromLoader ?? fromDocument;
};

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  const locale = loaderData?.locale ?? "en";
  const nonce = useNonce();
  const requestId = useRequestId();

  return (
    <html lang={locale} data-request-id={requestId} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  useChangeLanguage(loaderData.locale);
  const nonce = useNonce();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      nonce={nonce}
    >
      <TRPCProvider>
        <Outlet />
      </TRPCProvider>
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation("common");
  const requestId = useRequestId();
  useReportBoundaryError(error);

  let message = t("errors.oops");
  let details = t("errors.unexpected");
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? t("errors.404") : t("errors.error");
    details =
      error.status === 404
        ? t("errors.not_found")
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {requestId && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="error-request-id"
        >
          {t("errors.request_id", { id: requestId })}
        </p>
      )}
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
