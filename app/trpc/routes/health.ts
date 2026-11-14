import { Clock, Effect } from "effect";
import { adminProcedure } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { HealthRepository } from "@/repositories/health";

/**
 * What `admin.dbHealth` returns. A failed D1 query comes back as
 * `ok: false` with the error's tag in `error`, never as a thrown error, so
 * a caller can show a red status instead of an error toast.
 */
export interface DbHealth {
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

/**
 * `admin.dbHealth` — admin-only query, no input. Runs `select 1` against D1
 * through `HealthRepository.pingDatabase()` and stamps the result with the
 * time of the check. Merged into the admin router in `./admin.ts`.
 */
export const dbHealth = adminProcedure.query(({ ctx }) =>
  runProcedure(
    ctx.runtime,
    Effect.gen(function* () {
      const repo = yield* HealthRepository;
      const result = yield* repo.pingDatabase();
      const now = yield* Clock.currentTimeMillis;
      const health: DbHealth = {
        ok: result.ok,
        latencyMs: result.latencyMs,
        checkedAt: new Date(now).toISOString(),
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
      return health;
    }),
    { span: "trpc.admin.dbHealth" }
  )
);
