import { createRequestHandler } from "react-router";
import { Cause, Exit } from "effect";
import { appRouter } from "../app/trpc/router";
import { createCallerFactory, createTRPCContext } from "../app/trpc";
import type { Auth } from "@/auth/server";
import { AuthApi } from "@/services/auth";
import { makeAppRuntime, type AppRuntime } from "@/runtime";
import { loggers } from "@/lib/logger";
import {
  makeRequestContext,
  runWithRequestContext,
  type RequestContext,
} from "@/lib/request-context";
import { makeNonce, withSecurityHeaders } from "./security-headers";

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
    /** Per-request CSP nonce; see workers/security-headers.ts. */
    cspNonce: string;
    /** This request's id, also sent as `x-request-id`; see app/lib/request-context.ts. */
    requestId: string;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const internalError = (requestId: string) =>
  new Response(`Internal Server Error (request id: ${requestId})`, {
    status: 500,
  });

async function handle(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cspNonce: string,
  requestContext: RequestContext,
): Promise<Response> {
  const runtime = makeAppRuntime(env, new URL(request.url).origin, requestContext);

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
      loggers.server.error({ cause: Cause.pretty(authExit.cause) }, "Failed to construct AuthApi");
      return internalError(requestContext.requestId);
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
      cspNonce,
      requestId: requestContext.requestId,
    });
  } catch (err) {
    // Platform edge: context construction (e.g. session resolution in
    // createTRPCContext) can throw; return a controlled 500 instead of an
    // unhandled rejection. Effect-level failures are already mapped before
    // this point — this only catches boundary throws.
    loggers.server.error({ err }, "Unhandled error while building request context");
    return internalError(requestContext.requestId);
  } finally {
    ctx.waitUntil(runtime.dispose());
  }
}

export default {
  // The one place that applies the security headers and the request id:
  // every path out of `handle`, the two 500s included, passes through here.
  // The async-local store opened here is what plain `loggers.x.info(...)`
  // lines read their `requestId`/`userId` from; Effect code reads the same
  // context from the runtime instead.
  async fetch(request, env, ctx) {
    const nonce = makeNonce();
    const requestContext = makeRequestContext(request);
    const response = await runWithRequestContext(requestContext, () =>
      handle(request, env, ctx, nonce, requestContext),
    );
    const secured = withSecurityHeaders(response, {
      nonce,
      dev: import.meta.env.DEV,
    });
    // `withSecurityHeaders` returns a fresh response with mutable headers.
    secured.headers.set("x-request-id", requestContext.requestId);
    return secured;
  },
} satisfies ExportedHandler<Env>;
