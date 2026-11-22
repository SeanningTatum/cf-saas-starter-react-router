import { createContext, useContext } from "react";

/** The request id while the server renders; set in `entry.server.tsx`. */
export const RequestIdContext = createContext<string | undefined>(undefined);

/**
 * The id of the request that rendered this document. The server reads it from
 * the context; the browser reads `<html data-request-id>`, which the server
 * wrote, so both render the same text.
 *
 * Loader data cannot do this job alone: React Router skips the root loader on
 * a 404 or 405, which is exactly when the error page needs the id.
 */
export const useDocumentRequestId = (): string | undefined => {
  const fromServer = useContext(RequestIdContext);
  if (fromServer !== undefined) return fromServer;
  return typeof document === "undefined" ? undefined : document.documentElement.dataset.requestId;
};
