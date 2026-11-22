import { Clock, Effect } from "effect";
import { adminProcedure } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { HealthRepository } from "@/repositories/health";

export interface DbHealth {
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

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
