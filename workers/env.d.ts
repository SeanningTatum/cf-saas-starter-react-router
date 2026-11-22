// Secrets aren't declared in wrangler.jsonc, so `wrangler types` only picks
// them up from local .dev.vars/.env files — which don't exist on a fresh
// clone or CI runner. Declare them here (interface merging with the
// generated Env) so typecheck doesn't depend on local secret files.
interface Env {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  AUTH_TRUSTED_ORIGINS?: string;
  ANALYTICS_PROVIDER?: "none" | "console" | "posthog";
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
  ERROR_REPORTER?: "none" | "console" | "sentry";
  SENTRY_DSN?: string;
  RELEASE_VERSION?: string;
  ENVIRONMENT?: string;
  LOG_SAMPLE_RATE?: string;
  TRACE_SAMPLE_RATE?: string;
}
