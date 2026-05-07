import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Outlet, redirect } from "react-router";
import { AppSidebar } from "./layout/app-sidebar";
import type { Route } from "./+types/_layout";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) throw redirect("/login");
  if (session.user.role !== "admin") throw redirect("/dashboard");
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
      <AppSidebar variant="inset" />
      <SidebarInset>
        <Outlet context={loaderData} />
      </SidebarInset>
    </SidebarProvider>
  );
}