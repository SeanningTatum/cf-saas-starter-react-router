import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOBILE_BREAKPOINT_PX } from "@/lib/constants/viewport";
import { useIsMobile } from "../use-mobile";

type Listener = () => void;

const hook = vi.hoisted(() => ({
  state: undefined as unknown,
  cleanups: [] as Array<() => void>,
}));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useState: (initial: unknown) => {
      const setState = (next: unknown) => {
        hook.state = next;
      };
      return [hook.state === undefined ? initial : hook.state, setState];
    },
    useEffect: (effect: () => undefined | (() => void)) => {
      const cleanup = effect();
      if (typeof cleanup === "function") hook.cleanups.push(cleanup);
    },
  };
});

const fakeWindow = (innerWidth: number) => {
  const added: Listener[] = [];
  const removed: Listener[] = [];
  const queries: string[] = [];
  const win = {
    innerWidth,
    matchMedia: (query: string) => {
      queries.push(query);
      return {
        addEventListener: (type: string, listener: Listener) => {
          if (type === "change") added.push(listener);
        },
        removeEventListener: (type: string, listener: Listener) => {
          if (type === "change") removed.push(listener);
        },
      };
    },
  };
  vi.stubGlobal("window", win);
  return { win, added, removed, queries };
};

describe("useIsMobile", () => {
  beforeEach(() => {
    hook.state = undefined;
    hook.cleanups.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks matchMedia for one pixel under the breakpoint, so that a tablet exactly at the breakpoint is not treated as mobile by CSS and JS at once", () => {
    const { queries } = fakeWindow(MOBILE_BREAKPOINT_PX);
    useIsMobile();
    expect(queries).toEqual([`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`]);
  });

  it("reports true below the breakpoint and false at it, so that an off-by-one in the width check cannot flip the layout at exactly the breakpoint", () => {
    fakeWindow(MOBILE_BREAKPOINT_PX - 1);
    useIsMobile();
    expect(hook.state).toBe(true);

    hook.state = undefined;
    fakeWindow(MOBILE_BREAKPOINT_PX);
    useIsMobile();
    expect(hook.state).toBe(false);
  });

  it("re-reads the window width on a media change, so that rotating or resizing past the breakpoint updates the layout", () => {
    const { win, added } = fakeWindow(MOBILE_BREAKPOINT_PX + 200);
    useIsMobile();
    expect(hook.state).toBe(false);
    win.innerWidth = MOBILE_BREAKPOINT_PX - 200;
    for (const listener of added) listener();
    expect(hook.state).toBe(true);
  });

  it("removes the very listener it added on cleanup, so that an unmounted sidebar does not keep setting state on every resize", () => {
    const { added, removed } = fakeWindow(MOBILE_BREAKPOINT_PX);
    useIsMobile();
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(0);
    for (const cleanup of hook.cleanups) cleanup();
    expect(removed).toEqual(added);
  });

  it("returns false, not undefined, before the effect has measured, so that the first render is a strict boolean desktop layout", () => {
    fakeWindow(MOBILE_BREAKPOINT_PX - 1);
    expect(useIsMobile()).toBe(false);
    expect(hook.state).toBe(true);
    expect(useIsMobile()).toBe(true);
  });
});
