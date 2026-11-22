import { createRequestHandler } from "react-router";
import { Effect, Exit } from "effect";
import { appRouter } from "../app/trpc/router";
import { createCallerFactory, createTRPCContext } from "../app/trpc";
import type { Auth } from "@/auth/server";
import { AuthApi } from "@/services/auth";
import { makeAppRuntime, type AppRuntime } from "@/runtime";
import { HTTP_STATUS_ATTRIBUTE } from "@/lib/constants/error-reporting";
import type { ErrorCapture } from "@/lib/error-reporting/report";
import { decideSampling, readSampling } from "@/lib/sampling";
import {
  readEnvironment,
  reportError,
  requestErrorReporter,
  type ErrorReporterShape,
} from "@/services/error-reporter";
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
    cspNonce: string;
    requestId: string;
    reportError: (capture: ErrorCapture) => void;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
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
  errorReporter: ErrorReporterShape
): Promise<Response> {
  const runtime = makeAppRuntime(
    env,
    { dev: import.meta.env.DEV, requestOrigin: new URL(request.url).origin },
    requestContext,
    errorReporter
  );
  const report = (capture: ErrorCapture) => reportError(errorReporter, capture);
  const withStatusOnSpan = async (response: Response): Promise<Response> => {
    await runtime.runPromiseExit(
      Effect.annotateCurrentSpan(HTTP_STATUS_ATTRIBUTE, response.status)
    );
    return response;
  };

  try {
    const authExit = await runtime.runPromiseExit(AuthApi);
    if (Exit.isFailure(authExit)) {
      report({ error: authExit.cause, source: "fetch" });
      return internalError(requestContext.requestId);
    }
    const { auth } = authExit.value;

    const trpcContext = await createTRPCContext({
      headers: request.headers,
      runtime,
    });
    const trpcCaller = createCaller(trpcContext, {
      onError: ({ error }) => report({ error, source: "trpc" }),
    });

    return await withStatusOnSpan(
      await requestHandler(request, {
        cloudflare: { env, ctx },
        trpc: trpcCaller,
        auth,
        runtime,
        cspNonce,
        requestId: requestContext.requestId,
        reportError: report,
      })
    );
  } catch (err) {
    report({ error: err, source: "fetch" });
    return await withStatusOnSpan(internalError(requestContext.requestId));
  } finally {
    ctx.waitUntil(runtime.dispose());
  }
}

export default {
  async fetch(request, env, ctx) {
    const nonce = makeNonce();
    const requestContext = makeRequestContext(
      request,
      decideSampling(readSampling(env, readEnvironment(env)))
    );
    const errorReporter = requestErrorReporter(env, requestContext, (delivery) =>
      ctx.waitUntil(delivery)
    );
    const response = await runWithRequestContext(requestContext, () =>
      handle(request, env, ctx, nonce, requestContext, errorReporter)
    );
    const secured = withSecurityHeaders(response, {
      nonce,
      dev: import.meta.env.DEV,
    });
    secured.headers.set("x-request-id", requestContext.requestId);
    return secured;
  },
} satisfies ExportedHandler<Env>;
