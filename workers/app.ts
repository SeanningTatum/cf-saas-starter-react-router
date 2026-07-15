import { createRequestHandler } from "react-router";
import { Cause, Exit } from "effect";
import { appRouter } from "../app/trpc/router";
import { createCallerFactory, createTRPCContext } from "../app/trpc";
import type { Auth } from "@/auth/server";
import { AuthApi } from "@/services/auth";
import { makeAppRuntime, type AppRuntime } from "@/runtime";
import { loggers } from "@/lib/logger";

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
    const runtime = makeAppRuntime(env, new URL(request.url).origin);

    try {
      // Single entry edge: read the Better Auth instance off the runtime's
      // `AuthApi` tag (built via `AuthApiLive` — betterAuth() construction
      // wrapped in `Effect.try` → `ExternalServiceError`) instead of calling
      // `createAuth(...)` raw outside any Effect. `runPromiseExit` +
      // `Exit.match` keeps this a controlled 500 instead of an unhandled
      // rejection if config/bindings are broken; `auth` is then reused as
      // `context.auth` for React Router loaders exactly as before.
      const authExit = await runtime.runPromiseExit(AuthApi);
      if (Exit.isFailure(authExit)) {
        loggers.server.error(
          { cause: Cause.pretty(authExit.cause) },
          "Failed to construct AuthApi"
        );
        return new Response("Internal Server Error", { status: 500 });
      }
      const { auth } = authExit.value;

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
    } catch (err) {
      // Platform edge: context construction (e.g. session resolution in
      // createTRPCContext) can throw; return a controlled 500 instead of an
      // unhandled rejection. Effect-level failures are already mapped before
      // this point — this only catches boundary throws.
      loggers.server.error({ err }, "Unhandled error while building request context");
      return new Response("Internal Server Error", { status: 500 });
    } finally {
      ctx.waitUntil(runtime.dispose());
    }
  },
} satisfies ExportedHandler<Env>;
