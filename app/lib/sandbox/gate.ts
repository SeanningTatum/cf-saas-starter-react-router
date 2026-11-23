import { Effect } from "effect";
import { SANDBOX_ON } from "@/lib/constants/sandbox";
import { SandboxDisabledError } from "@/models/errors/sandbox";

export interface SandboxEnv {
  readonly SANDBOX_ENABLED?: string;
}

export const checkSandboxEnabled = (
  env: SandboxEnv,
  built: boolean,
): Effect.Effect<void, SandboxDisabledError> => {
  if (!built) return Effect.fail(new SandboxDisabledError({ reason: "not-built" }));
  return env.SANDBOX_ENABLED === SANDBOX_ON
    ? Effect.void
    : Effect.fail(new SandboxDisabledError({ reason: "flag-off" }));
};
