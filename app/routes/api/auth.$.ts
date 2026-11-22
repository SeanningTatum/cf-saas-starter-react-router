import { Cause, Effect, Exit } from "effect";
import { guardAuthRequest, rateLimitedResponse } from "@/auth/request-gate";
import { AUTH_GATE_FAULT_MESSAGE } from "@/lib/constants/rate-limit";
import { loggers } from "@/lib/logger";
import type { Route } from "./+types/auth.$";

const refusalFor = (request: Request) =>
  guardAuthRequest(request).pipe(
    Effect.as(null),
    Effect.catchTag("RateLimitError", (error) => Effect.succeed(rateLimitedResponse(error)))
  );

export async function loader({ request, context }: Route.LoaderArgs) {
  return context.auth.handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  const exit = await context.runtime.runPromiseExit(refusalFor(request));
  return Exit.match(exit, {
    onSuccess: (refusal) => refusal ?? context.auth.handler(request),
    onFailure: (cause) => {
      loggers.auth.error({ cause: Cause.pretty(cause) }, AUTH_GATE_FAULT_MESSAGE);
      return context.auth.handler(request);
    },
  });
}
