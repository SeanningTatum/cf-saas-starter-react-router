import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { I18nextProvider } from "react-i18next";
import i18next from "./i18n/i18n.client";

startTransition(() => {
  hydrateRoot(
    document,
    <I18nextProvider i18n={i18next}>
      <StrictMode>
        <HydratedRouter />
      </StrictMode>
    </I18nextProvider>
  );
});
