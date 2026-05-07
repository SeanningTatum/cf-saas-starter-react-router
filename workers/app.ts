import { createRequestHandler } from "react-router";
import { appRouter } from "../app/trpc/router";
import { createCallerFactory, createTRPCContext } from "../app/trpc";
import { createAuth, type Auth } from "@/auth/server";
import { makeAppRuntime, type AppRuntime } from "@/runtime";

const createCaller = createCallerFactory(appRouter);

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
    trpc: ReturnType<typeof createCaller>;
    auth: Auth;
    runtime: AppRuntime;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export { ExampleWorkflow } from "../workflows/example";

export default {
  async fetch(request, env, ctx) {
    const auth = createAuth(
      env.DATABASE,
      env.BETTER_AUTH_SECRET,
      new URL(request.url).origin
    );
    // Single auth instance per request — reused via context.auth in routes/loaders.
    const runtime = makeAppRuntime(env, auth);

    try {
      const trpcContext = await createTRPCContext({
        headers: request.headers,
        runtime,
      });
      const trpcCaller = createCaller(trpcContext);

      return await requestHandler(request, {
        cloudflare: { env, ctx },
        trpc: trpcCaller,
        auth,
        runtime,
      });
    } finally {
      ctx.waitUntil(runtime.dispose());
    }
  },
} satisfies ExportedHandler<Env>;
