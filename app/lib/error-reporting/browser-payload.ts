import type { BROWSER_ERROR_SOURCES } from "@/lib/constants/error-reporting";

export type BrowserErrorSource = (typeof BROWSER_ERROR_SOURCES)[number];

export interface BrowserErrorPayload {
  readonly source: BrowserErrorSource;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly url: string;
  readonly requestId?: string;
}
