import { createContext, useContext } from "react";

/**
 * The per-request CSP nonce, set in `entry.server.tsx`. Undefined on the
 * client: the browser hides nonce attributes once it has parsed them.
 */
export const NonceContext = createContext<string | undefined>(undefined);

export const useNonce = () => useContext(NonceContext);
