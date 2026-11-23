import { describe, expect, it } from "vitest";
import { holdSuccessToast, takeHeldSuccessToast, type ToastStore } from "../held-toast";

const memoryStore = (): ToastStore => {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
};

const blockedStore = (): ToastStore => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

describe("held success toast", () => {
  it("hands a message held before a full page load to the next page, once", () => {
    const store = memoryStore();
    expect(holdSuccessToast(() => store, "Now impersonating Ada")).toBe(true);
    expect(takeHeldSuccessToast(() => store)).toBe("Now impersonating Ada");
    expect(takeHeldSuccessToast(() => store)).toBeNull();
  });

  it("finds nothing on a page load that no action held a toast for", () => {
    expect(takeHeldSuccessToast(memoryStore)).toBeNull();
  });

  it("drops the toast instead of failing when the browser blocks session storage", () => {
    expect(holdSuccessToast(blockedStore, "Now impersonating Ada")).toBe(false);
    expect(takeHeldSuccessToast(blockedStore)).toBeNull();
  });
});
