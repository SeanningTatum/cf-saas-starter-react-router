import type { Route } from "./+types/sign-up";
import { SignupForm } from "./components/signup-form";
import { AuthShell } from "./components/auth-shell";
import { redirectIfAuthenticated } from "@/lib/session";
import { AuthApi } from "@/services/auth";

export const handle = { i18n: ["auth"] };

export async function loader({ request, context }: Route.LoaderArgs) {
  await redirectIfAuthenticated(request, context);
  const { turnstileSiteKey } = await context.runtime.runPromise(AuthApi);
  return { turnstileSiteKey };
}

export default function SignUp({ loaderData }: Route.ComponentProps) {
  return (
    <AuthShell>
      <SignupForm turnstileSiteKey={loaderData.turnstileSiteKey} />
    </AuthShell>
  );
}
