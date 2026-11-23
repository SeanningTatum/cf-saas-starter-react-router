import { HELD_TOAST_STORAGE_KEY } from "@/lib/constants/toast";

export type ToastStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const settle = <A>(read: () => A, fallback: A): Promise<A> =>
  new Promise<A>((resolve) => resolve(read())).then(
    (value) => value,
    () => fallback,
  );

export const holdSuccessToast = (store: () => ToastStore, message: string): Promise<boolean> =>
  settle(() => {
    store().setItem(HELD_TOAST_STORAGE_KEY, message);
    return true;
  }, false);

export const takeHeldSuccessToast = (store: () => ToastStore): Promise<string | null> =>
  settle(() => {
    const storage = store();
    const message = storage.getItem(HELD_TOAST_STORAGE_KEY);
    storage.removeItem(HELD_TOAST_STORAGE_KEY);
    return message === "" ? null : message;
  }, null);
