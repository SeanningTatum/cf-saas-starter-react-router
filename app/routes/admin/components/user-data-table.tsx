import * as React from "react";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconSearch,
} from "@tabler/icons-react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useSearchParams, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
import type { User } from "@/db/schema";
import { USER_SEARCH_DEBOUNCE_MS } from "@/lib/constants/admin";
import { buildUserColumns } from "./user-table-columns";
import { useUserRowActions } from "./use-user-row-actions";

type UserDataTableProps = {
  initialUsers: User[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
};

export function UserDataTable({
  initialUsers,
  initialTotal,
  initialPage,
  initialPageSize,
}: UserDataTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const { revalidate } = revalidator;
  const { t, i18n } = useTranslation("admin");
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const [searchInput, setSearchInput] = React.useState(searchParams.get("search") || "");

  // biome-ignore lint/correctness/useExhaustiveDependencies: updateSearchParams is new each render, so listing it would restart the debounce every render
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== searchParams.get("search")) {
        updateSearchParams({ search: searchInput || undefined, page: "1" });
      }
    }, USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, searchParams]);

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

  const actions = useUserRowActions(t, revalidate);

  const columns = React.useMemo(
    () => buildUserColumns({ t, language: i18n.language, actions }),
    [t, i18n.language, actions],
  );

  const totalPages = Math.ceil(initialTotal / initialPageSize);

  const table = useReactTable({
    data: initialUsers,
    columns,
    getRowId: (user) => user.id,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
    },
    pageCount: totalPages,
    manualPagination: true,
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:max-w-sm sm:flex-1">
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
              .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {revalidator.state === "loading" ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {t("users_table.loading_users")}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {t("users_table.no_users_found")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 px-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground flex-1 text-sm">
          {t("users_table.rows_selected", {
            selected: table.getFilteredSelectedRowModel().rows.length,
            total: initialTotal,
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:gap-6">
          <div className="flex items-center gap-2">
            <Label htmlFor="rows-per-page" className="text-sm font-medium whitespace-nowrap">
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
          <div className="flex w-fit items-center justify-center text-sm font-medium whitespace-nowrap">
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
              onClick={() => updateSearchParams({ page: String(initialPage - 1) })}
              disabled={initialPage <= 1}
            >
              <span className="sr-only">{t("users_table.previous_page")}</span>
              <IconChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => updateSearchParams({ page: String(initialPage + 1) })}
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
