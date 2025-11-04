import { createTRPCContext } from "@/trpc";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/trpc/router";

import type { Route } from "./+types/trpc.$";

import { createAuth } from "@/auth/server";
import type { AppLoadContext } from "react-router";

const handler = async (req: Request, context: AppLoadContext) => {
  const auth = await createAuth(
    context.cloudflare.env.DATABASE,
    context.cloudflare.env.BETTER_AUTH_SECRET
  );

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () =>
      createTRPCContext({
        headers: req.headers,
        database: context.cloudflare.env.DATABASE,
        auth,
      }),
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error);
    },
  });
};

export async function loader({ request, context }: Route.LoaderArgs) {
  return handler(request, context);
}

export async function action({ request, context }: Route.ActionArgs) {
  return handler(request, context);
}
