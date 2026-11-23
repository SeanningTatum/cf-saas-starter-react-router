interface Env {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  AUTH_TRUSTED_ORIGINS?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
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
