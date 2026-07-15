import { createTRPCContext } from "@/trpc";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/trpc/router";
import { loggers } from "@/lib/logger";

import type { Route } from "./+types/trpc.$";

import type { AppLoadContext } from "react-router";

const handler = async (req: Request, context: AppLoadContext) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () =>
      createTRPCContext({
        headers: req.headers,
        runtime: context.runtime,
      }),
    onError({ error, path }) {
      loggers.trpc.error(
        { path, code: error.code, stack: error.stack },
        error.message
      );
    },
  });
};

export async function loader({ request, context }: Route.LoaderArgs) {
  return handler(request, context);
}

export async function action({ request, context }: Route.ActionArgs) {
  return handler(request, context);
}
