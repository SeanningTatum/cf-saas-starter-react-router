import { createContext, useContext } from "react";

export const NonceContext = createContext<string | undefined>(undefined);

export const useNonce = () => useContext(NonceContext);
