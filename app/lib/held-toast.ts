import { Effect } from "effect";
import { HELD_TOAST_STORAGE_KEY } from "@/lib/constants/toast";

export type ToastStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const holdSuccessToast = (store: () => ToastStore, message: string): boolean =>
  Effect.runSync(
    Effect.try(() => {
      store().setItem(HELD_TOAST_STORAGE_KEY, message);
      return true;
    }).pipe(Effect.orElseSucceed(() => false)),
  );

export const takeHeldSuccessToast = (store: () => ToastStore): string | null =>
  Effect.runSync(
    Effect.try(() => {
      const storage = store();
      const message = storage.getItem(HELD_TOAST_STORAGE_KEY);
      storage.removeItem(HELD_TOAST_STORAGE_KEY);
      return message === "" ? null : message;
    }).pipe(Effect.orElseSucceed(() => null)),
  );
