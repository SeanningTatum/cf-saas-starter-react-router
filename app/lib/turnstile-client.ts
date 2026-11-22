import { Either } from "effect";
import {
  TURNSTILE_DEFAULT_LANGUAGE,
  TURNSTILE_FLEXIBLE_MIN_WIDTH_PX,
  TURNSTILE_LANGUAGES,
  TURNSTILE_LOCALE_SEPARATOR,
  TURNSTILE_SCRIPT_TIMEOUT_MS,
  TURNSTILE_TOKEN_HEADER,
} from "@/lib/constants/turnstile";

export type TurnstileTheme = "light" | "dark";
export type TurnstileSize = "flexible" | "compact";
export type TurnstileStatus = "loading" | "ready" | "error" | "expired";
export type TurnstileFailure = "script" | "challenge";

export interface TurnstileRenderOptions {
  readonly sitekey: string;
  readonly theme: TurnstileTheme;
  readonly size: TurnstileSize;
  readonly language: string;
  readonly "refresh-expired": "auto";
  readonly callback: (token: string) => void;
  readonly "error-callback": () => boolean;
  readonly "expired-callback": () => void;
  readonly "timeout-callback": () => void;
}

export interface TurnstileApi<Container = HTMLElement> {
  readonly render: (container: Container, options: TurnstileRenderOptions) => string | null | undefined;
  readonly reset: (widgetId: string) => void;
  readonly remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileState {
  readonly status: TurnstileStatus;
  readonly token: string | null;
  readonly failure: TurnstileFailure | null;
  readonly rendered: boolean;
}

export type TurnstileEvent =
  | { readonly type: "load" }
  | { readonly type: "rendered" }
  | { readonly type: "reset" }
  | { readonly type: "solved"; readonly token: string }
  | { readonly type: "expired" }
  | { readonly type: "failed"; readonly failure: TurnstileFailure };

export const initialTurnstileState = (): TurnstileState => ({
  status: "loading",
  token: null,
  failure: null,
  rendered: false,
});

export const turnstileReducer = (state: TurnstileState, event: TurnstileEvent): TurnstileState => {
  switch (event.type) {
    case "load":
      return initialTurnstileState();
    case "rendered":
      return { ...state, rendered: true };
    case "reset":
      return { ...state, status: "loading", token: null, failure: null };
    case "solved":
      return { ...state, status: "ready", token: event.token, failure: null };
    case "expired":
      return { ...state, status: "expired", token: null, failure: null };
    case "failed":
      return { ...state, status: "error", token: null, failure: event.failure };
  }
};

export const widgetSizeFor = (containerWidth: number): TurnstileSize =>
  containerWidth >= TURNSTILE_FLEXIBLE_MIN_WIDTH_PX ? "flexible" : "compact";

export const turnstileTheme = (resolvedTheme: string | undefined): TurnstileTheme | null =>
  resolvedTheme === "dark" || resolvedTheme === "light" ? resolvedTheme : null;

export const turnstileLanguage = (appLanguage: string | undefined): string => {
  const base = appLanguage?.toLowerCase().split(TURNSTILE_LOCALE_SEPARATOR)[0];
  return (base && TURNSTILE_LANGUAGES[base]) || TURNSTILE_DEFAULT_LANGUAGE;
};

export const captchaFetchOptions = (token: string | null) =>
  token === null ? undefined : { headers: { [TURNSTILE_TOKEN_HEADER]: token } };

export interface ScriptTag {
  addEventListener(type: "load" | "error", listener: () => void): void;
  remove(): void;
}

export interface TurnstileScriptHost<Container = HTMLElement> {
  readonly api: () => TurnstileApi<Container> | undefined;
  readonly findScript: () => ScriptTag | null;
  readonly addScript: () => ScriptTag;
  readonly setTimer: (run: () => void, ms: number) => () => void;
}

export const loadTurnstileScript = <Container>(
  host: TurnstileScriptHost<Container>
): Promise<TurnstileApi<Container> | null> => {
  const loaded = host.api();
  if (loaded) return Promise.resolve(loaded);
  return new Promise((resolve) => {
    const script = host.findScript() ?? host.addScript();
    const settle = (api: TurnstileApi<Container> | null) => {
      cancelTimer();
      if (api === null) script.remove();
      resolve(api);
    };
    const cancelTimer = host.setTimer(() => settle(null), TURNSTILE_SCRIPT_TIMEOUT_MS);
    script.addEventListener("load", () => settle(host.api() ?? null));
    script.addEventListener("error", () => settle(null));
  });
};

export interface TurnstileMountOptions {
  readonly sitekey: string;
  readonly theme: TurnstileTheme;
  readonly size: TurnstileSize;
  readonly language: string;
  readonly dispatch: (event: TurnstileEvent) => void;
}

export interface TurnstileHandle {
  readonly reset: () => boolean;
  readonly remove: () => void;
}

export const turnstileRenderOptions = ({
  dispatch,
  ...widget
}: TurnstileMountOptions): TurnstileRenderOptions => ({
  ...widget,
  "refresh-expired": "auto",
  callback: (token) => dispatch({ type: "solved", token }),
  "error-callback": () => {
    dispatch({ type: "failed", failure: "challenge" });
    return true;
  },
  "expired-callback": () => dispatch({ type: "expired" }),
  "timeout-callback": () => dispatch({ type: "expired" }),
});

export const mountTurnstile = <Container>(
  api: TurnstileApi<Container>,
  container: Container,
  options: TurnstileMountOptions
): TurnstileHandle | null => {
  const rendered = Either.try(() => api.render(container, turnstileRenderOptions(options)));
  if (Either.isLeft(rendered) || !rendered.right) return null;
  const widgetId = rendered.right;
  return {
    reset: () => Either.isRight(Either.try(() => api.reset(widgetId))),
    remove: () => {
      Either.try(() => api.remove(widgetId));
    },
  };
};
