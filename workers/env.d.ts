// Secrets aren't declared in wrangler.jsonc, so `wrangler types` only picks
// them up from local .dev.vars/.env files — which don't exist on a fresh
// clone or CI runner. Declare them here (interface merging with the
// generated Env) so typecheck doesn't depend on local secret files.
interface Env {
  BETTER_AUTH_SECRET: string;
  ANALYTICS_PROVIDER?: "none" | "console" | "posthog";
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}
