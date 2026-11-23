import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { RealAnalyticsProviderError } from "../../app/models/errors/fixture";
import { ANALYTICS_PROVIDER_LINES, LOCAL_ENV_FILES, REAL_ANALYTICS_PROVIDER, UNREADABLE_PROVIDER } from "./analytics-guard-constants";

export const providerSetIn = (text: string): string | undefined => Array.from(text.matchAll(ANALYTICS_PROVIDER_LINES), (match) => match[1]).at(-1);

const refuseFile = (root: string, file: string) =>
  Effect.gen(function* () {
    const path = join(root, file);
    if (!existsSync(path)) return;
    const text = yield* Effect.try({
      try: () => readFileSync(path, "utf8"),
      catch: () =>
        new RealAnalyticsProviderError({
          file,
          provider: UNREADABLE_PROVIDER,
          message: `${file} cannot be read, so the run cannot prove analytics is off`,
        }),
    });
    const provider = providerSetIn(text);
    if (provider === REAL_ANALYTICS_PROVIDER) {
      return yield* new RealAnalyticsProviderError({
        file,
        provider,
        message: `${file} sets ANALYTICS_PROVIDER=${provider}; e2e runs would send real events. Unset it or use console`,
      });
    }
  });

export const refuseRealAnalytics = (root: string) => Effect.forEach(LOCAL_ENV_FILES, (file) => refuseFile(root, file), { discard: true });
