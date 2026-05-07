import type { Route } from "./+types/auth.$";

export async function loader({ request, context }: Route.LoaderArgs) {
  return context.auth.handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  return context.auth.handler(request);
}
