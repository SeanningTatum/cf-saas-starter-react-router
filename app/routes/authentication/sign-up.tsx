import type { Route } from "./+types/sign-up";
import { SignupForm } from "./components/signup-form";
import { AuthShell } from "./components/auth-shell";
import { redirectIfAuthenticated } from "@/lib/session";

export const handle = { i18n: ["auth"] };

export async function loader({ request, context }: Route.LoaderArgs) {
  await redirectIfAuthenticated(request, context);
  return {};
}

export default function SignUp() {
  return (
    <AuthShell>
      <SignupForm />
    </AuthShell>
  );
}
