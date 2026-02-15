import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/_layout";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) return redirect("/login");
  return { user: session.user };
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="min-h-screen bg-background">
      <Outlet context={loaderData} />
    </div>
  );
}
