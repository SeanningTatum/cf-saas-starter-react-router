import type { Route } from "./+types/login";
import { LoginForm } from "./components/login-form";
import { AuthShell } from "./components/auth-shell";
import { redirectIfAuthenticated } from "@/lib/session";
import { AuthApi } from "@/services/auth";

export const handle = { i18n: ["auth"] };

export async function loader({ request, context }: Route.LoaderArgs) {
  await redirectIfAuthenticated(request, context);
  const { turnstileSiteKey } = await context.runtime.runPromise(AuthApi);
  return { turnstileSiteKey };
}

export default function Login({ loaderData }: Route.ComponentProps) {
  return (
    <AuthShell>
      <LoginForm turnstileSiteKey={loaderData.turnstileSiteKey} />
    </AuthShell>
  );
}
