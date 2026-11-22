import { describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_FLEXIBLE_MIN_WIDTH_PX,
  TURNSTILE_SCRIPT_TIMEOUT_MS,
  TURNSTILE_TOKEN_HEADER,
} from "@/lib/constants/turnstile";
import {
  captchaFetchOptions,
  initialTurnstileState,
  loadTurnstileScript,
  mountTurnstile,
  turnstileLanguage,
  turnstileReducer,
  turnstileRenderOptions,
  turnstileTheme,
  widgetSizeFor,
  type ScriptTag,
  type TurnstileApi,
  type TurnstileEvent,
  type TurnstileRenderOptions,
  type TurnstileScriptHost,
  type TurnstileState,
} from "../turnstile-client";

const run = (events: ReadonlyArray<TurnstileEvent>, from: TurnstileState = initialTurnstileState()) =>
  events.reduce(turnstileReducer, from);

const fakeScript = () => {
  const listeners = new Map<string, () => void>();
  const tag: ScriptTag & { removed: boolean; fire: (type: "load" | "error") => void } = {
    removed: false,
    addEventListener: (type, listener) => {
      listeners.set(type, listener);
    },
    remove: () => {
      tag.removed = true;
    },
    fire: (type) => listeners.get(type)?.(),
  };
  return tag;
};

const fakeApi = (renderResult: string | null = "widget-1") => {
  const calls: Array<{ container: string; options: TurnstileRenderOptions }> = [];
  const api: TurnstileApi<string> = {
    render: (container, options) => {
      calls.push({ container, options });
      return renderResult;
    },
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return { api, calls };
};

const fakeHost = (script = fakeScript(), existing: ScriptTag | null = null) => {
  const timers: Array<() => void> = [];
  const cancel = vi.fn();
  const state: { api: TurnstileApi<string> | undefined } = { api: undefined };
  const host: TurnstileScriptHost<string> = {
    api: () => state.api,
    findScript: () => existing,
    addScript: vi.fn(() => script),
    setTimer: (runTimer, ms) => {
      expect(ms).toBe(TURNSTILE_SCRIPT_TIMEOUT_MS);
      timers.push(runTimer);
      return cancel;
    },
  };
  return { host, script, state, timers, cancel };
};

describe("turnstileReducer", () => {
  it("starts loading with no token, so submit stays off until the check passes", () => {
    expect(initialTurnstileState()).toEqual({
      status: "loading",
      token: null,
      failure: null,
      rendered: false,
      rechecking: false,
    });
  });

  it("holds the token once solved and marks the widget ready", () => {
    expect(run([{ type: "rendered" }, { type: "solved", token: "t1" }])).toEqual({
      status: "ready",
      token: "t1",
      failure: null,
      rendered: true,
      rechecking: false,
    });
  });

  it("drops a spent token on reset, keeps the widget on screen and says the check runs again", () => {
    expect(run([{ type: "rendered" }, { type: "solved", token: "t1" }, { type: "reset" }])).toEqual({
      status: "loading",
      token: null,
      failure: null,
      rendered: true,
      rechecking: true,
    });
  });

  it("says loading, not running again, on the first load even after the widget renders", () => {
    expect(run([{ type: "load" }, { type: "rendered" }])).toMatchObject({ status: "loading", rechecking: false });
  });

  it("asks the user to act and drops the token when an unsolved check times out", () => {
    const state = run([{ type: "solved", token: "t1" }, { type: "timedOut" }]);
    expect(state).toMatchObject({ status: "expired", token: null, rechecking: false });
  });

  it("drops the token and records why when the widget fails", () => {
    const state = run([{ type: "solved", token: "t1" }, { type: "failed", failure: "challenge" }]);
    expect(state).toMatchObject({ status: "error", token: null, failure: "challenge" });
  });

  it("clears a script failure on a fresh load", () => {
    const state = run([{ type: "failed", failure: "script" }, { type: "load" }]);
    expect(state).toEqual(initialTurnstileState());
  });

  it("gets a new token after a timeout without a reload", () => {
    const state = run([{ type: "solved", token: "t1" }, { type: "timedOut" }, { type: "solved", token: "t2" }]);
    expect(state).toMatchObject({ status: "ready", token: "t2", rechecking: false });
  });
});

describe("widget options", () => {
  it("uses the flexible widget only where its 300px minimum fits", () => {
    expect(TURNSTILE_FLEXIBLE_MIN_WIDTH_PX).toBe(300);
    expect(widgetSizeFor(TURNSTILE_FLEXIBLE_MIN_WIDTH_PX)).toBe("flexible");
    expect(widgetSizeFor(309)).toBe("flexible");
    expect(widgetSizeFor(336)).toBe("flexible");
    expect(widgetSizeFor(TURNSTILE_FLEXIBLE_MIN_WIDTH_PX - 1)).toBe("compact");
  });

  it("follows the app theme and waits while the theme is still unknown", () => {
    expect(turnstileTheme("dark")).toBe("dark");
    expect(turnstileTheme("light")).toBe("light");
    expect(turnstileTheme(undefined)).toBeNull();
    expect(turnstileTheme("system")).toBeNull();
  });

  it("speaks the app's language and lets Turnstile pick for any other", () => {
    expect(turnstileLanguage("en")).toBe("en");
    expect(turnstileLanguage("zh")).toBe("zh-cn");
    expect(turnstileLanguage("zh-CN")).toBe("zh-cn");
    expect(turnstileLanguage("fr")).toBe("auto");
    expect(turnstileLanguage(undefined)).toBe("auto");
  });

  it("sends the token in the captcha header and sends no header without one", () => {
    expect(captchaFetchOptions("t1")).toEqual({ headers: { [TURNSTILE_TOKEN_HEADER]: "t1" } });
    expect(captchaFetchOptions(null)).toBeUndefined();
  });

  it("treats an expired token as a check running again and a timed-out check as one the user must rerun", () => {
    const dispatch = vi.fn();
    const options = turnstileRenderOptions({ sitekey: "k", theme: "dark", size: "compact", language: "en", dispatch });
    expect(options).toMatchObject({
      sitekey: "k",
      theme: "dark",
      size: "compact",
      language: "en",
      "refresh-expired": "auto",
      "refresh-timeout": "never",
    });
    expect(options).not.toHaveProperty("dispatch");
    options.callback("t1");
    expect(options["error-callback"]()).toBe(true);
    options["expired-callback"]();
    options["timeout-callback"]();
    expect(dispatch.mock.calls.map(([event]) => event)).toEqual([
      { type: "solved", token: "t1" },
      { type: "failed", failure: "challenge" },
      { type: "reset" },
      { type: "timedOut" },
    ]);
  });

  it("keeps an expired token out of the problem box: the widget is loading again and submit waits", () => {
    const events: Array<TurnstileEvent> = [];
    const options = turnstileRenderOptions({
      sitekey: "k",
      theme: "light",
      size: "flexible",
      language: "en",
      dispatch: (event) => events.push(event),
    });
    options.callback("t1");
    options["expired-callback"]();
    expect(run(events, { ...initialTurnstileState(), rendered: true })).toMatchObject({
      status: "loading",
      token: null,
      rechecking: true,
    });
  });
});

describe("loadTurnstileScript", () => {
  it("reuses an API that is already on the page instead of adding a second script", async () => {
    const { host, state } = fakeHost();
    state.api = fakeApi().api;
    await expect(loadTurnstileScript(host)).resolves.toBe(state.api);
    expect(host.addScript).not.toHaveBeenCalled();
  });

  it("waits on a script tag that is already loading instead of adding another", async () => {
    const existing = fakeScript();
    const { host, state, cancel } = fakeHost(fakeScript(), existing);
    const loading = loadTurnstileScript(host);
    state.api = fakeApi().api;
    existing.fire("load");
    await expect(loading).resolves.toBe(state.api);
    expect(host.addScript).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("resolves null and removes the tag when the script is blocked, so a retry adds a fresh one", async () => {
    const { host, script } = fakeHost();
    const loading = loadTurnstileScript(host);
    script.fire("error");
    await expect(loading).resolves.toBeNull();
    expect(script.removed).toBe(true);
  });

  it("resolves null when the script never loads, so the form does not wait forever", async () => {
    const { host, script, timers } = fakeHost();
    const loading = loadTurnstileScript(host);
    timers.forEach((fire) => fire());
    await expect(loading).resolves.toBeNull();
    expect(script.removed).toBe(true);
  });

  it("resolves null when the script loads but defines no API", async () => {
    const { host, script } = fakeHost();
    const loading = loadTurnstileScript(host);
    script.fire("load");
    await expect(loading).resolves.toBeNull();
  });
});

describe("mountTurnstile", () => {
  const options = { sitekey: "k", theme: "light" as const, size: "flexible" as const, language: "en", dispatch: vi.fn() };

  it("renders into the given container and resets and removes that same widget", () => {
    const { api, calls } = fakeApi("w9");
    const handle = mountTurnstile(api, "box", options);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.container).toBe("box");
    expect(handle?.reset()).toBe(true);
    handle?.remove();
    expect(api.reset).toHaveBeenCalledWith("w9");
    expect(api.remove).toHaveBeenCalledWith("w9");
  });

  it("returns null when the widget refuses to render, so the form can show an error", () => {
    expect(mountTurnstile(fakeApi(null).api, "box", options)).toBeNull();
    const throwing: TurnstileApi<string> = {
      render: () => JSON.parse("{"),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    expect(mountTurnstile(throwing, "box", options)).toBeNull();
  });

  it("reports a failed reset instead of leaving the form waiting", () => {
    const api: TurnstileApi<string> = {
      render: () => "w1",
      reset: () => JSON.parse("{"),
      remove: () => JSON.parse("{"),
    };
    const handle = mountTurnstile(api, "box", options);
    expect(handle?.reset()).toBe(false);
    expect(() => handle?.remove()).not.toThrow();
  });
});
