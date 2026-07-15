import * as React from "react";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconDotsVertical,
  IconSearch,
  IconUserCheck,
  IconUserX,
  IconShieldCheck,
  IconShield,
  IconUserCog,
} from "@tabler/icons-react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { useSearchParams, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";

import { authClient } from "@/auth/client";
import { formatDate } from "@/lib/date-utils";
import { getInitials } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { User } from "@/db/schema";


type UserDataTableProps = {
  initialUsers: User[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
};

/**
 * Shared runner for the admin action menu (impersonate/ban/unban/role change):
 * calls `action`, toasts success/error based on the Better Auth `{ error }`
 * response shape, and reports unexpected throws the same way as a `response.error`.
 * `onSuccess` lets each caller decide how to refresh (revalidate vs. reload).
 */
async function runAdminAction<T extends { error?: unknown } | null | undefined>(
  action: () => Promise<T>,
  { successMessage, errorMessage, onSuccess }: {
    successMessage: string;
    errorMessage: string;
    onSuccess?: () => void;
  }
): Promise<void> {
  try {
    const response = await action();
    if (response?.error) {
      toast.error(errorMessage);
      return;
    }
    toast.success(successMessage);
    onSuccess?.();
  } catch (error) {
    console.error(errorMessage, error);
    toast.error(errorMessage);
  }
}

export function UserDataTable({
  initialUsers,
  initialTotal,
  initialPage,
  initialPageSize,
}: UserDataTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const { t, i18n } = useTranslation("admin");
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // Debounced search to avoid too many updates
  const [searchInput, setSearchInput] = React.useState(
    searchParams.get("search") || ""
  );

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== searchParams.get("search")) {
        updateSearchParams({ search: searchInput || undefined, page: "1" });
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, searchParams]);

  // Update URL search params (triggers refetch via loader)
  const updateSearchParams = (updates: Record<string, string | undefined>) => {
    const newSearchParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        newSearchParams.set(key, value);
      } else {
        newSearchParams.delete(key);
      }
    });
    setSearchParams(newSearchParams);
  };

  const handleImpersonate = (userId: string, userName: string) =>
    runAdminAction(() => authClient.admin.impersonateUser({ userId }), {
      successMessage: t("users_table.toasts.impersonate_success", { name: userName }),
      errorMessage: t("users_table.toasts.impersonate_error", { name: userName }),
      // Reload the page to apply the new session
      onSuccess: () => window.location.reload(),
    });

  const handleBanUser = (userId: string, userName: string) =>
    runAdminAction(
      () =>
        authClient.admin.banUser({ userId, banReason: "Banned by admin" }),
      {
        successMessage: t("users_table.toasts.ban_success", { name: userName }),
        errorMessage: t("users_table.toasts.ban_error", { name: userName }),
        onSuccess: () => revalidator.revalidate(),
      }
    );

  const handleUnbanUser = (userId: string, userName: string) =>
    runAdminAction(() => authClient.admin.unbanUser({ userId }), {
      successMessage: t("users_table.toasts.unban_success", { name: userName }),
      errorMessage: t("users_table.toasts.unban_error", { name: userName }),
      onSuccess: () => revalidator.revalidate(),
    });

  const handleRoleChange = (
    userId: string,
    userName: string,
    newRole: "user" | "admin"
  ) =>
    runAdminAction(
      () => authClient.admin.setRole({ userId, role: newRole }),
      {
        successMessage: t("users_table.toasts.role_update_success", {
          name: userName,
          role: t(`users_table.roles.${newRole}`),
        }),
        errorMessage: t("users_table.toasts.role_update_error", { name: userName }),
        onSuccess: () => revalidator.revalidate(),
      }
    );

  const columns: ColumnDef<User>[] = [
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
              <span className="text-muted-foreground text-sm">
                {user.email}
              </span>
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
        const role = row.original.role;
        return (
          <Badge
            variant={role === "admin" ? "default" : "outline"}
            className="capitalize"
          >
            {role === "admin" ? (
              <IconShieldCheck className="mr-1 h-3 w-3" />
            ) : (
              <IconShield className="mr-1 h-3 w-3" />
            )}
            {t(`users_table.roles.${role === "admin" ? "admin" : "user"}`)}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      },
    },
    {
      accessorKey: "emailVerified",
      header: t("users_table.columns.status"),
      cell: ({ row }) => {
        const verified = row.original.emailVerified;
        const banned = row.original.banned;

        if (banned) {
          return (
            <Badge variant="destructive">
              <IconUserX className="mr-1 h-3 w-3" />
              {t("users_table.statuses.banned")}
            </Badge>
          );
        }

        return (
          <Badge variant={verified ? "default" : "outline"}>
            {verified ? (
              <IconUserCheck className="mr-1 h-3 w-3" />
            ) : null}
            {verified
              ? t("users_table.statuses.verified")
              : t("users_table.statuses.unverified")}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        if (value === "verified") return row.original.emailVerified === true;
        if (value === "unverified") return row.original.emailVerified === false;
        if (value === "banned") return row.original.banned === true;
        return true;
      },
    },
    {
      accessorKey: "createdAt",
      header: t("users_table.columns.joined"),
      cell: ({ row }) => {
        return formatDate(
          new Date(row.original.createdAt),
          "MMM d, yyyy",
          i18n.language
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const user = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
                size="icon"
              >
                <IconDotsVertical className="h-4 w-4" />
                <span className="sr-only">{t("users_table.open_menu")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t("users_table.actions_label")}</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => handleImpersonate(user.id, user.name)}
                className="cursor-pointer"
              >
                <IconUserCog className="mr-2 h-4 w-4" />
                {t("users_table.impersonate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("users_table.change_role")}</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => handleRoleChange(user.id, user.name, "admin")}
                disabled={user.role === "admin"}
                className="cursor-pointer"
              >
                <IconShieldCheck className="mr-2 h-4 w-4" />
                {t("users_table.make_admin")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRoleChange(user.id, user.name, "user")}
                disabled={user.role === "user"}
                className="cursor-pointer"
              >
                <IconShield className="mr-2 h-4 w-4" />
                {t("users_table.make_user")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {user.banned ? (
                <DropdownMenuItem
                  onClick={() => handleUnbanUser(user.id, user.name)}
                  className="cursor-pointer"
                >
                  <IconUserCheck className="mr-2 h-4 w-4" />
                  {t("users_table.unban_user")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => handleBanUser(user.id, user.name)}
                  variant="destructive"
                  className="cursor-pointer"
                >
                  <IconUserX className="mr-2 h-4 w-4" />
                  {t("users_table.ban_user")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  // Calculate total pages
  const totalPages = Math.ceil(initialTotal / initialPageSize);

  const table = useReactTable({
    data: initialUsers,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
    },
    pageCount: totalPages,
    manualPagination: true, // Server-side pagination
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  return (
    <div className="w-full space-y-4">
      {/* Filters and Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 sm:max-w-sm">
            <IconSearch className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder={t("users_table.search_placeholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={searchParams.get("role") || "all"}
            onValueChange={(value) =>
              updateSearchParams({
                role: value === "all" ? undefined : value,
                page: "1",
              })
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder={t("users_table.role_placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("users_table.roles.all")}</SelectItem>
              <SelectItem value="admin">{t("users_table.roles.admin")}</SelectItem>
              <SelectItem value="user">{t("users_table.roles.user")}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={searchParams.get("status") || "all"}
            onValueChange={(value) =>
              updateSearchParams({
                status: value === "all" ? undefined : value,
                page: "1",
              })
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder={t("users_table.status_placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("users_table.statuses.all")}</SelectItem>
              <SelectItem value="verified">{t("users_table.statuses.verified")}</SelectItem>
              <SelectItem value="unverified">{t("users_table.statuses.unverified")}</SelectItem>
              <SelectItem value="banned">{t("users_table.statuses.banned")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {t("users_table.columns_button")}
              <IconChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {table
              .getAllColumns()
              .filter(
                (column) =>
                  typeof column.accessorFn !== "undefined" &&
                  column.getCanHide()
              )
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {revalidator.state === "loading" ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {t("users_table.loading_users")}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {t("users_table.no_users_found")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-2">
        <div className="text-muted-foreground flex-1 text-sm">
          {t("users_table.rows_selected", {
            selected: table.getFilteredSelectedRowModel().rows.length,
            total: initialTotal,
          })}
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Label htmlFor="rows-per-page" className="text-sm font-medium">
              {t("users_table.rows_per_page")}
            </Label>
            <Select
              value={`${initialPageSize}`}
              onValueChange={(value) => {
                updateSearchParams({
                  pageSize: value,
                  page: "1",
                });
              }}
            >
              <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                <SelectValue placeholder={initialPageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 30, 40, 50].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-fit items-center justify-center text-sm font-medium">
            {t("users_table.page_of", { page: initialPage, total: totalPages || 1 })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => updateSearchParams({ page: "1" })}
              disabled={initialPage <= 1}
            >
              <span className="sr-only">{t("users_table.first_page")}</span>
              <IconChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() =>
                updateSearchParams({ page: String(initialPage - 1) })
              }
              disabled={initialPage <= 1}
            >
              <span className="sr-only">{t("users_table.previous_page")}</span>
              <IconChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() =>
                updateSearchParams({ page: String(initialPage + 1) })
              }
              disabled={initialPage >= totalPages}
            >
              <span className="sr-only">{t("users_table.next_page")}</span>
              <IconChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => updateSearchParams({ page: String(totalPages) })}
              disabled={initialPage >= totalPages}
            >
              <span className="sr-only">{t("users_table.last_page")}</span>
              <IconChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
