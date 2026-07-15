import type { Route } from "./+types/login";
import { LoginForm } from "./components/login-form";
import { AuthShell } from "./components/auth-shell";
import { redirectIfAuthenticated } from "@/lib/session";

export const handle = { i18n: ["auth"] };

export async function loader({ request, context }: Route.LoaderArgs) {
  await redirectIfAuthenticated(request, context);
  return {};
}

export default function Login() {
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
