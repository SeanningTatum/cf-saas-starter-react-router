import { ADMIN_ROLE, ROLE_LIST_SEPARATOR } from "@/lib/constants/admin";

export interface ProtectionTarget {
  readonly id: string;
  readonly role?: string | null;
}

export const hasAdminRole = (role: string | null | undefined): boolean =>
  (role ?? "")
    .split(ROLE_LIST_SEPARATOR)
    .some((one) => one.trim() === ADMIN_ROLE);

export const isProtectedUser = (
  target: ProtectionTarget,
  currentUserId: string
): boolean => hasAdminRole(target.role) || target.id === currentUserId;
