import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { EllipsisVertical, Shield, ShieldCheck, UserCheck, UserCog, UserX } from "lucide-react";

import { formatDate } from "@/lib/date-utils";
import { getInitials } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { User } from "@/db/schema";

export type UserRole = "user" | "admin";

export interface UserRowActions {
  readonly impersonate: (user: User) => void;
  readonly ban: (user: User) => void;
  readonly unban: (user: User) => void;
  readonly setRole: (user: User, role: UserRole) => void;
}

interface UserColumnsInput {
  readonly t: TFunction<"admin">;
  readonly language: string;
  readonly actions: UserRowActions;
}

function RowActionsMenu({ user, t, actions }: { user: User } & Omit<UserColumnsInput, "language">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
          size="icon"
        >
          <EllipsisVertical className="size-4" aria-hidden />
          <span className="sr-only">{t("users_table.open_menu")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t("users_table.actions_label")}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => actions.impersonate(user)} className="cursor-pointer">
          <UserCog className="mr-2 size-4" aria-hidden />
          {t("users_table.impersonate")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("users_table.change_role")}</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => actions.setRole(user, "admin")}
          disabled={user.role === "admin"}
          className="cursor-pointer"
        >
          <ShieldCheck className="mr-2 size-4" aria-hidden />
          {t("users_table.make_admin")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => actions.setRole(user, "user")}
          disabled={user.role === "user"}
          className="cursor-pointer"
        >
          <Shield className="mr-2 size-4" aria-hidden />
          {t("users_table.make_user")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {user.banned ? (
          <DropdownMenuItem onClick={() => actions.unban(user)} className="cursor-pointer">
            <UserCheck className="mr-2 size-4" aria-hidden />
            {t("users_table.unban_user")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => actions.ban(user)}
            variant="destructive"
            className="cursor-pointer"
          >
            <UserX className="mr-2 size-4" aria-hidden />
            {t("users_table.ban_user")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function buildUserColumns({ t, language, actions }: UserColumnsInput): ColumnDef<User>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={t("users_table.select_all")}
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={t("users_table.select_row")}
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "name",
      header: t("users_table.columns.user"),
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.image || undefined} alt={user.name} />
              <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium">{user.name}</span>
              <span className="text-muted-foreground text-sm">{user.email}</span>
            </div>
          </div>
        );
      },
      enableHiding: false,
    },
    {
      accessorKey: "role",
      header: t("users_table.columns.role"),
      cell: ({ row }) => {
        const isAdmin = row.original.role === "admin";
        const RoleIcon = isAdmin ? ShieldCheck : Shield;
        return (
          <Badge variant={isAdmin ? "default" : "outline"} className="capitalize">
            <RoleIcon className="mr-1 size-3" aria-hidden />
            {t(`users_table.roles.${isAdmin ? "admin" : "user"}`)}
          </Badge>
        );
      },
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: "emailVerified",
      header: t("users_table.columns.status"),
      cell: ({ row }) => {
        const { emailVerified: verified, banned } = row.original;
        if (banned) {
          return (
            <Badge variant="destructive">
              <UserX className="mr-1 size-3" aria-hidden />
              {t("users_table.statuses.banned")}
            </Badge>
          );
        }
        return (
          <Badge variant={verified ? "default" : "outline"}>
            {verified ? <UserCheck className="mr-1 size-3" aria-hidden /> : null}
            {verified ? t("users_table.statuses.verified") : t("users_table.statuses.unverified")}
          </Badge>
        );
      },
      filterFn: (row, _id, value) => {
        if (value === "verified") return row.original.emailVerified === true;
        if (value === "unverified") return row.original.emailVerified === false;
        if (value === "banned") return row.original.banned === true;
        return true;
      },
    },
    {
      accessorKey: "createdAt",
      header: t("users_table.columns.joined"),
      cell: ({ row }) => formatDate(new Date(row.original.createdAt), "MMM d, yyyy", language),
    },
    {
      id: "actions",
      cell: ({ row }) => <RowActionsMenu user={row.original} t={t} actions={actions} />,
    },
  ];
}
