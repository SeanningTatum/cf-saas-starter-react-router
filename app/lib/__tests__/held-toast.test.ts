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
  it("hands a message held before a full page load to the next page, once", async () => {
    const store = memoryStore();
    await expect(holdSuccessToast(() => store, "Now impersonating Ada")).resolves.toBe(true);
    await expect(takeHeldSuccessToast(() => store)).resolves.toBe("Now impersonating Ada");
    await expect(takeHeldSuccessToast(() => store)).resolves.toBeNull();
  });

  it("finds nothing on a page load that no action held a toast for", async () => {
    await expect(takeHeldSuccessToast(memoryStore)).resolves.toBeNull();
  });

  it("drops the toast instead of failing when the browser blocks session storage", async () => {
    await expect(holdSuccessToast(blockedStore, "Now impersonating Ada")).resolves.toBe(false);
    await expect(takeHeldSuccessToast(blockedStore)).resolves.toBeNull();
  });
});
