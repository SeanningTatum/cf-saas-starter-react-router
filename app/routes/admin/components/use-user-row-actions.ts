import { useMemo } from "react";
import type { TFunction } from "i18next";
import { authClient } from "@/auth/client";
import { toast } from "@/components/ui/sonner";
import { ROUTES } from "@/lib/constants/routes";
import { reportHandledError } from "@/lib/error-reporting/browser";
import { holdSuccessToast } from "@/lib/held-toast";
import type { UserRowActions } from "./user-table-columns";

interface AdminActionMessages {
  readonly successMessage: string;
  readonly errorMessage: string;
  readonly onSuccess?: () => void;
  readonly announceSuccess?: (message: string) => void | Promise<void>;
}

const showSuccess = (message: string) => {
  toast.success(message);
};

const holdSuccessForDashboard = async (message: string) => {
  if (!(await holdSuccessToast(() => window.sessionStorage, message))) toast.success(message);
};

const openDashboardAsImpersonatedUser = () => window.location.assign(ROUTES.dashboard);

const runAdminAction = <T extends { error?: unknown } | null | undefined>(
  action: () => Promise<T>,
  { successMessage, errorMessage, onSuccess, announceSuccess = showSuccess }: AdminActionMessages,
): Promise<void> =>
  Promise.resolve()
    .then(action)
    .then(
      async (response) => {
        if (response?.error) {
          toast.error(errorMessage);
          return;
        }
        await announceSuccess(successMessage);
        onSuccess?.();
      },
      (error: unknown) => {
        reportHandledError(error);
        toast.error(errorMessage);
      },
    );

export function useUserRowActions(t: TFunction<"admin">, revalidate: () => Promise<void>) {
  return useMemo<UserRowActions>(
    () => ({
      impersonate: ({ id, name }) =>
        runAdminAction(() => authClient.admin.impersonateUser({ userId: id }), {
          successMessage: t("users_table.toasts.impersonate_success", { name }),
          errorMessage: t("users_table.toasts.impersonate_error", { name }),
          announceSuccess: holdSuccessForDashboard,
          onSuccess: openDashboardAsImpersonatedUser,
        }),
      ban: ({ id, name }) =>
        runAdminAction(
          () => authClient.admin.banUser({ userId: id, banReason: "Banned by admin" }),
          {
            successMessage: t("users_table.toasts.ban_success", { name }),
            errorMessage: t("users_table.toasts.ban_error", { name }),
            onSuccess: revalidate,
          },
        ),
      unban: ({ id, name }) =>
        runAdminAction(() => authClient.admin.unbanUser({ userId: id }), {
          successMessage: t("users_table.toasts.unban_success", { name }),
          errorMessage: t("users_table.toasts.unban_error", { name }),
          onSuccess: revalidate,
        }),
      setRole: ({ id, name }, role) =>
        runAdminAction(() => authClient.admin.setRole({ userId: id, role }), {
          successMessage: t("users_table.toasts.role_update_success", {
            name,
            role: t(`users_table.roles.${role}`),
          }),
          errorMessage: t("users_table.toasts.role_update_error", { name }),
          onSuccess: revalidate,
        }),
    }),
    [t, revalidate],
  );
}
