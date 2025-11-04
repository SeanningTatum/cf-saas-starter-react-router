import { createAuth } from "@/auth/server";
import type { Route } from "./+types/auth.$";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = await createAuth(
    context.cloudflare.env.DATABASE,
    context.cloudflare.env.BETTER_AUTH_SECRET
  );
  return auth.handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = await createAuth(
    context.cloudflare.env.DATABASE,
    context.cloudflare.env.BETTER_AUTH_SECRET
  );
  return auth.handler(request);
}
