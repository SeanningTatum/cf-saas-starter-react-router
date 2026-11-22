import { redirect, type AppLoadContext } from "react-router";
import { getSession } from "@/services/session";
import { activeSession } from "@/auth/ban";
import { hasAdminRole } from "@/auth/protected-user";

/**
 * The non-null shape returned by `context.auth.api.getSession(...)` once a
 * session exists. `AppLoadContext["auth"]` is Better Auth's `Auth` instance
 * (see `workers/app.ts`), so this type tracks whatever `createAuth` returns
 * without redeclaring it.
 */
export type Session = NonNullable<
  Awaited<ReturnType<AppLoadContext["auth"]["api"]["getSession"]>>
>;

const readActiveSession = async (
  request: Request,
  context: AppLoadContext
): Promise<Session | null> =>
  activeSession(
    await context.runtime.runPromise(
      getSession(context.auth.api, request.headers)
    ),
    new Date()
  );

export async function requireSession(
  request: Request,
  context: AppLoadContext
): Promise<Session> {
  const session = await readActiveSession(request, context);
  if (!session) throw redirect("/login");
  return session;
}

export async function requireAdmin(
  request: Request,
  context: AppLoadContext
): Promise<Session> {
  const session = await requireSession(request, context);
  if (!hasAdminRole(session.user.role)) throw redirect("/dashboard");
  return session;
}

export async function redirectIfAuthenticated(
  request: Request,
  context: AppLoadContext,
  to = "/dashboard"
): Promise<void> {
  const session = await readActiveSession(request, context);
  if (session) throw redirect(to);
}
