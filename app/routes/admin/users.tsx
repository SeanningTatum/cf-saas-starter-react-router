import { SiteHeader } from "./layout/site-header";
import { UserDataTable } from "./components/user-data-table";
import type { Route } from "./+types/users";
import type { User } from "@/db/schema";
import { useTranslation } from "react-i18next";

export const handle = { i18n: ["admin"] };

export const loader = async ({ context, request }: Route.LoaderArgs) => {
  const url = new URL(request.url);

  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("pageSize") || "10");
  const search = url.searchParams.get("search") || undefined;
  const roleParam = url.searchParams.get("role");
  const statusParam = url.searchParams.get("status");

  const role =
    roleParam && roleParam !== "all"
      ? (roleParam as "user" | "admin")
      : undefined;
  const status =
    statusParam && statusParam !== "all"
      ? (statusParam as "verified" | "unverified" | "banned")
      : undefined;

  const response = await context.trpc.admin.getUsers({
    page: page - 1,
    limit: pageSize,
    search,
    role,
    status,
  });

  return {
    users: response.users as User[],
    total: response.total,
    page,
    pageSize,
    search,
    role: roleParam,
    status: statusParam,
  };
};

export default function Users({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-6">
      <SiteHeader title={t("users.title")} />
      <div className="px-4 lg:px-6">
        <UserDataTable
          initialUsers={loaderData.users}
          initialTotal={loaderData.total}
          initialPage={loaderData.page}
          initialPageSize={loaderData.pageSize}
        />
      </div>
    </div>
  );
}
