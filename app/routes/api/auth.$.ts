import { Cause, Exit } from "effect";
import { authGate } from "@/auth/request-gate";
import { AUTH_GATE_FAULT_MESSAGE } from "@/lib/constants/rate-limit";
import { isDev } from "@/lib/log-format";
import { loggers } from "@/lib/logger";
import type { Route } from "./+types/auth.$";

export async function loader({ request, context }: Route.LoaderArgs) {
  return context.auth.handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  const exit = await context.runtime.runPromiseExit(authGate(request, isDev));
  return Exit.match(exit, {
    onSuccess: (refusal) => refusal ?? context.auth.handler(request),
    onFailure: (cause) => {
      loggers.auth.error({ cause: Cause.pretty(cause) }, AUTH_GATE_FAULT_MESSAGE);
      context.reportError({ error: cause, source: "action" });
      return context.auth.handler(request);
    },
  });
}
