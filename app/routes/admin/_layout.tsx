import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Outlet } from "react-router";
import { AppSidebar } from "./layout/app-sidebar";
import { requireAdmin } from "@/lib/session";
import type { Route } from "./+types/_layout";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireAdmin(request, context);
  return { user: session.user };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={loaderData.user} />
      <SidebarInset>
        <Outlet context={loaderData} />
      </SidebarInset>
    </SidebarProvider>
  );
}