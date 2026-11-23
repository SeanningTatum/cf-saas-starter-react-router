import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { I18nextProvider } from "react-i18next";
import { i18next } from "./i18n/i18n.client";
import {
  installBrowserErrorReporting,
  reportRecoverableError,
} from "./lib/error-reporting/browser";

installBrowserErrorReporting();

startTransition(() => {
  hydrateRoot(
    document,
    <I18nextProvider i18n={i18next}>
      <StrictMode>
        <HydratedRouter />
      </StrictMode>
    </I18nextProvider>,
    { onRecoverableError: reportRecoverableError },
  );
});
