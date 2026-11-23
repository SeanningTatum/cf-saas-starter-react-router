import { redirect, type AppLoadContext } from "react-router";
import { getSession } from "@/services/session";
import { activeSession } from "@/auth/ban";
import { hasAdminRole } from "@/auth/protected-user";
import { ROUTES } from "@/lib/constants/routes";

export type Session = NonNullable<Awaited<ReturnType<AppLoadContext["auth"]["api"]["getSession"]>>>;

const readActiveSession = async (
  request: Request,
  context: AppLoadContext,
): Promise<Session | null> =>
  activeSession(
    await context.runtime.runPromise(getSession(context.auth.api, request.headers)),
    new Date(),
  );

export async function requireSession(request: Request, context: AppLoadContext): Promise<Session> {
  const session = await readActiveSession(request, context);
  if (!session) throw redirect(ROUTES.login);
  return session;
}

export async function requireAdmin(request: Request, context: AppLoadContext): Promise<Session> {
  const session = await requireSession(request, context);
  if (!hasAdminRole(session.user.role)) throw redirect(ROUTES.dashboard);
  return session;
}

export async function redirectIfAuthenticated(
  request: Request,
  context: AppLoadContext,
  to: string = ROUTES.dashboard,
): Promise<void> {
  const session = await readActiveSession(request, context);
  if (session) throw redirect(to);
}
