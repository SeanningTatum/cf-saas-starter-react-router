import { redirect, type AppLoadContext } from "react-router";

/**
 * The non-null shape returned by `context.auth.api.getSession(...)` once a
 * session exists. `AppLoadContext["auth"]` is Better Auth's `Auth` instance
 * (see `workers/app.ts`), so this type tracks whatever `createAuth` returns
 * without redeclaring it.
 */
export type Session = NonNullable<
  Awaited<ReturnType<AppLoadContext["auth"]["api"]["getSession"]>>
>;

/**
 * Loader auth gate: resolves the current session or redirects to `/login`.
 * Centralizes the `context.auth.api.getSession({ headers })` + redirect
 * branching duplicated across the admin/dashboard layouts and auth routes.
 */
export async function requireSession(
  request: Request,
  context: AppLoadContext
): Promise<Session> {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) throw redirect("/login");
  return session;
}

/**
 * Loader auth gate: resolves the current session and requires `role === "admin"`,
 * redirecting non-admins to `/dashboard` (and unauthenticated users to `/login`
 * via `requireSession`).
 */
export async function requireAdmin(
  request: Request,
  context: AppLoadContext
): Promise<Session> {
  const session = await requireSession(request, context);
  if (session.user.role !== "admin") throw redirect("/dashboard");
  return session;
}

/**
 * Loader guard for public-only routes (home, login, sign-up): redirects an
 * already-authenticated visitor to `to` (default `/dashboard`) instead of
 * rendering the route.
 */
export async function redirectIfAuthenticated(
  request: Request,
  context: AppLoadContext,
  to = "/dashboard"
): Promise<void> {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (session) throw redirect(to);
}
