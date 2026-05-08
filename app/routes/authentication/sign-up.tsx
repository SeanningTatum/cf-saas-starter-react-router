import { redirect } from "react-router";
import type { Route } from "./+types/sign-up";
import { SignupForm } from "./components/signup-form";
import { AuthShell } from "./components/auth-shell";

export const handle = { i18n: ["auth"] };

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (session) return redirect("/dashboard");
  return {};
}

export default function SignUp() {
  return (
    <AuthShell>
      <SignupForm />
    </AuthShell>
  );
}
