import { SANDBOX_ENABLED_VAR, SANDBOX_ON } from "../constants/sandbox";

export interface SandboxBuildEnv {
  readonly DEV?: boolean;
  readonly VITE_SANDBOX?: string;
}

export const sandboxBuildOn = (env: SandboxBuildEnv): boolean =>
  env.DEV === true || env.VITE_SANDBOX === SANDBOX_ON;

export const sandboxWorkerVars = (on: boolean): Readonly<Record<string, string>> =>
  on ? { [SANDBOX_ENABLED_VAR]: SANDBOX_ON } : {};
