import { createRequestHandler } from "react-router";
import { appRouter } from "../app/trpc/router";
import { createCallerFactory, createTRPCContext } from "../app/trpc";
import { createAuth } from "@/auth/server";

const createCaller = createCallerFactory(appRouter);

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
    trpc: ReturnType<typeof createCaller>;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export { ExampleWorkflow } from "../workflows/example";

export default {
  async fetch(request, env, ctx) {
    const trpcContext = await createTRPCContext({
      headers: request.headers,
      database: env.DATABASE,
      auth: await createAuth(env.DATABASE, env.BETTER_AUTH_SECRET),
    });

    const trpcCaller = createCaller(trpcContext);

    return requestHandler(request, {
      cloudflare: { env, ctx },
      trpc: trpcCaller,
    });
  },
} satisfies ExportedHandler<Env>;
