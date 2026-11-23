import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHydrated } from "../use-hydrated";

type Store = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => boolean;
  getServerSnapshot: () => boolean;
};

const captured = vi.hoisted(() => ({ stores: [] as Store[] }));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useSyncExternalStore: (
      subscribe: Store["subscribe"],
      getSnapshot: Store["getSnapshot"],
      getServerSnapshot: Store["getServerSnapshot"],
    ) => {
      captured.stores.push({ subscribe, getSnapshot, getServerSnapshot });
      return real.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
  };
});

const Probe = () => createElement("span", null, String(useHydrated()));

const lastStore = () => {
  renderToString(createElement(Probe));
  const store = captured.stores.at(-1);
  if (store === undefined) throw new Error("useHydrated did not call useSyncExternalStore");
  return store;
};

describe("useHydrated", () => {
  beforeEach(() => {
    captured.stores.length = 0;
  });

  it("renders false on the server, so that markup gated on hydration never ships in the SSR HTML and mismatches the client", () => {
    expect(renderToString(createElement(Probe))).toBe("<span>false</span>");
  });

  it("reads true from the client snapshot and false from the server snapshot, so that a swap of the two cannot show client-only UI during SSR or hide it after hydration", () => {
    const store = lastStore();
    expect(store.getSnapshot()).toBe(true);
    expect(store.getServerSnapshot()).toBe(false);
  });

  it("subscribes without ever calling back and returns an unsubscribe that does not throw, so that the hydrated flag never flips back and unmount stays safe", () => {
    const store = lastStore();
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(onChange);
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });
});
