import { Duration, Effect, Either } from "effect";
import { sql } from "drizzle-orm";
import { Database } from "@/services/database";
import { tryQuery } from "@/lib/effect-utils";

export interface DatabasePing {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export class HealthRepository extends Effect.Service<HealthRepository>()(
  "app/HealthRepository",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* Database;

      // A failed ping is data, not an error: the caller shows a red status
      // instead of an error toast, so the error channel stays `never`.
      const pingDatabase = (): Effect.Effect<DatabasePing> =>
        tryQuery("health", () => db.run(sql`select 1`)).pipe(
          Effect.either,
          Effect.timed,
          Effect.map(([duration, result]): DatabasePing => {
            const latencyMs = Duration.toMillis(duration);
            return Either.isRight(result)
              ? { ok: true, latencyMs }
              : { ok: false, latencyMs, error: result.left._tag };
          })
        );

      return { pingDatabase } as const;
    }),
  }
) {}
