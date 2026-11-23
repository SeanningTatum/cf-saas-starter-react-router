import { createContext, useContext } from "react";

export const RequestIdContext = createContext<string | undefined>(undefined);

export const useDocumentRequestId = (): string | undefined => {
  const fromServer = useContext(RequestIdContext);
  if (fromServer !== undefined) return fromServer;
  return typeof document === "undefined" ? undefined : document.documentElement.dataset.requestId;
};
