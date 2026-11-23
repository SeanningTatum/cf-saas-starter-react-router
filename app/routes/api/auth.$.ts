import { Cause, Exit } from "effect";
import type { AppLoadContext } from "react-router";
import { authGate } from "@/auth/request-gate";
import { FIRST_SERVER_ERROR_STATUS } from "@/lib/constants/error-reporting";
import { AUTH_GATE_FAULT_MESSAGE } from "@/lib/constants/rate-limit";
import type { ErrorSource } from "@/lib/error-reporting/adapter";
import { isDev } from "@/lib/log-format";
import { loggers } from "@/lib/logger";
import type { Route } from "./+types/auth.$";

const reportServerFailure = (
  context: AppLoadContext,
  source: ErrorSource,
  response: Response,
): Response => {
  if (response.status >= FIRST_SERVER_ERROR_STATUS) {
    context.reportError({
      error: { status: response.status, statusText: "" },
      source,
      requestId: context.requestId,
    });
  }
  return response;
};

const handled = async (
  request: Request,
  context: AppLoadContext,
  source: ErrorSource,
): Promise<Response> => reportServerFailure(context, source, await context.auth.handler(request));

export async function loader({ request, context }: Route.LoaderArgs) {
  return handled(request, context, "loader");
}

export async function action({ request, context }: Route.ActionArgs) {
  const exit = await context.runtime.runPromiseExit(authGate(request, isDev));
  return Exit.match(exit, {
    onSuccess: (refusal) => refusal ?? handled(request, context, "action"),
    onFailure: (cause) => {
      loggers.auth.error({ cause: Cause.pretty(cause) }, AUTH_GATE_FAULT_MESSAGE);
      context.reportError({ error: cause, source: "action" });
      return handled(request, context, "action");
    },
  });
}
