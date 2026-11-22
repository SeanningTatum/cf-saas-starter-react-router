import type { SeedLogin } from "./harness-config";
import { CREDENTIAL_SEPARATOR, NAME_LIST_SEPARATOR, NO_LOGINS_TEXT } from "./harness-config-constants";

export function resolveLogin(raw: string, seedLogins: Record<string, SeedLogin>): SeedLogin | { error: string } {
  const at = raw.indexOf(CREDENTIAL_SEPARATOR);
  if (at >= 1) return { email: raw.slice(0, at), password: raw.slice(at + 1) };
  if (at === 0) return { error: "--login expects <name> or <email:password>" };
  const seeded = Object.hasOwn(seedLogins, raw) ? seedLogins[raw] : undefined;
  if (seeded !== undefined) return seeded;
  const names = Object.keys(seedLogins);
  return { error: `unknown login "${raw}"; seeded logins: ${names.length === 0 ? NO_LOGINS_TEXT : names.join(NAME_LIST_SEPARATOR)}` };
}
