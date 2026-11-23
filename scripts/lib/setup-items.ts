import {
  ACCOUNT_ID_VARIABLE,
  CLOUDFLARE_ACCOUNT_URL,
  CLOUDFLARE_TOKENS_URL,
  ENV_SUFFIX,
  FLAG_PREFIX,
  GH_PRODUCTION_ENVIRONMENT,
  GH_STAGING_ENVIRONMENT,
  POSTHOG_KEYS_URL,
  PRODUCTION_ENVIRONMENT,
  SENTRY_DSN_URL,
  SETUP_ENV_PREFIX,
  SETUP_ENVIRONMENTS,
  TURNSTILE_DASHBOARD_URL,
  type SetupEnvironment,
} from "./setup-constants";
import type { ValueCheck } from "./setup-validate";

export type Store = "wrangler-secret" | "wrangler-var" | "gh-secret" | "gh-env-secret" | "gh-variable";

export interface Companion {
  readonly name: string;
  readonly value: string;
}

export interface SetupItem {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly store: Store;
  readonly name: string;
  readonly environment: SetupEnvironment;
  readonly ghEnvironment?: string;
  readonly secret: boolean;
  readonly required: boolean;
  readonly check: ValueCheck;
  readonly companion?: Companion;
  readonly generated?: boolean;
  readonly link?: string;
  readonly pairWith?: string;
}

interface Template {
  readonly base: string;
  readonly group: string;
  readonly label: string;
  readonly store: Store;
  readonly name: string;
  readonly check: ValueCheck;
  readonly requiredIn?: SetupEnvironment;
  readonly companion?: Companion;
  readonly generated?: boolean;
  readonly link?: string;
  readonly pairBase?: string;
}

const secretStore = (store: Store): boolean => store === "wrangler-secret" || store === "gh-secret" || store === "gh-env-secret";

const PER_ENVIRONMENT: ReadonlyArray<Template> = [
  {
    base: "auth-secret",
    group: "auth",
    label: "Auth secret",
    store: "wrangler-secret",
    name: "BETTER_AUTH_SECRET",
    check: "auth-secret",
    requiredIn: PRODUCTION_ENVIRONMENT,
    generated: true,
  },
  { base: "auth-url", group: "auth", label: "Auth URL", store: "wrangler-var", name: "BETTER_AUTH_URL", check: "auth-url", requiredIn: PRODUCTION_ENVIRONMENT },
  { base: "trusted-origins", group: "auth", label: "Trusted origins", store: "wrangler-var", name: "AUTH_TRUSTED_ORIGINS", check: "origins" },
  {
    base: "turnstile-site-key",
    group: "turnstile",
    label: "Turnstile site key",
    store: "wrangler-var",
    name: "TURNSTILE_SITE_KEY",
    check: "turnstile-key",
    link: TURNSTILE_DASHBOARD_URL,
    pairBase: "turnstile-secret-key",
  },
  {
    base: "turnstile-secret-key",
    group: "turnstile",
    label: "Turnstile secret key",
    store: "wrangler-secret",
    name: "TURNSTILE_SECRET_KEY",
    check: "turnstile-key",
    link: TURNSTILE_DASHBOARD_URL,
    pairBase: "turnstile-site-key",
  },
  {
    base: "sentry-dsn",
    group: "errors",
    label: "Error reporter (Sentry DSN)",
    store: "wrangler-secret",
    name: "SENTRY_DSN",
    check: "dsn",
    link: SENTRY_DSN_URL,
    companion: { name: "ERROR_REPORTER", value: "sentry" },
  },
  {
    base: "posthog-key",
    group: "analytics",
    label: "Analytics (PostHog key)",
    store: "wrangler-secret",
    name: "POSTHOG_API_KEY",
    check: "text",
    link: POSTHOG_KEYS_URL,
    companion: { name: "ANALYTICS_PROVIDER", value: "posthog" },
  },
  {
    base: "posthog-host",
    group: "analytics",
    label: "Analytics (PostHog host)",
    store: "wrangler-var",
    name: "POSTHOG_HOST",
    check: "https-url",
    link: POSTHOG_KEYS_URL,
  },
];

const expand = (template: Template, environment: SetupEnvironment): SetupItem => ({
  id: `${template.base}${ENV_SUFFIX[environment]}`,
  group: template.group,
  label: template.label,
  store: template.store,
  name: template.name,
  environment,
  secret: secretStore(template.store),
  required: template.requiredIn === environment,
  check: template.check,
  ...(template.companion ? { companion: template.companion } : {}),
  ...(template.generated ? { generated: true } : {}),
  ...(template.link ? { link: template.link } : {}),
  ...(template.pairBase ? { pairWith: `${template.pairBase}${ENV_SUFFIX[environment]}` } : {}),
});

const GITHUB_ITEMS: ReadonlyArray<SetupItem> = [
  {
    id: "account-id",
    group: "deploy",
    label: "Cloudflare account id",
    store: "gh-variable",
    name: ACCOUNT_ID_VARIABLE,
    environment: PRODUCTION_ENVIRONMENT,
    secret: false,
    required: true,
    check: "account-id",
    link: CLOUDFLARE_ACCOUNT_URL,
  },
  {
    id: "production-token",
    group: "deploy",
    label: "Production deploy token",
    store: "gh-env-secret",
    name: "CLOUDFLARE_API_TOKEN",
    environment: PRODUCTION_ENVIRONMENT,
    ghEnvironment: GH_PRODUCTION_ENVIRONMENT,
    secret: true,
    required: true,
    check: "token",
    link: CLOUDFLARE_TOKENS_URL,
  },
  {
    id: "preview-token",
    group: "deploy",
    label: "Preview token",
    store: "gh-secret",
    name: "CLOUDFLARE_PREVIEW_API_TOKEN",
    environment: "preview",
    secret: true,
    required: false,
    check: "token",
    link: CLOUDFLARE_TOKENS_URL,
  },
  {
    id: "staging-token",
    group: "deploy",
    label: "Staging token",
    store: "gh-env-secret",
    name: "CLOUDFLARE_STAGING_API_TOKEN",
    environment: "staging",
    ghEnvironment: GH_STAGING_ENVIRONMENT,
    secret: true,
    required: false,
    check: "token",
    link: CLOUDFLARE_TOKENS_URL,
  },
];

export const SETUP_ITEMS: ReadonlyArray<SetupItem> = [
  ...GITHUB_ITEMS,
  ...SETUP_ENVIRONMENTS.flatMap((environment) => PER_ENVIRONMENT.map((template) => expand(template, environment))),
];

export const itemById = (id: string): SetupItem | undefined => SETUP_ITEMS.find((item) => item.id === id);

export const flagOf = (item: SetupItem): string => `${FLAG_PREFIX}${item.id}`;

export const envVarOf = (item: SetupItem): string => `${SETUP_ENV_PREFIX}${item.id.toUpperCase().replaceAll("-", "_")}`;

export const GROUP_NAMES: ReadonlyArray<string> = [...new Set(SETUP_ITEMS.map((item) => item.group))];
