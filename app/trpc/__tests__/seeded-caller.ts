import type { SQL } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach } from "vitest";
import type { AnalyticsEvent } from "@/lib/analytics/events";
import type { ScenarioName } from "@/lib/fixtures/schema";
import { AnalyticsRepository } from "@/repositories/analytics";
import { HealthRepository } from "@/repositories/health";
import { AccountRepository } from "@/repositories/account";
import { UploadRepository } from "@/repositories/upload";
import { UserRepository } from "@/repositories/user";
import { makeFakeBucket } from "@/services/__tests__/fake-bucket";
import type { AppRuntime } from "@/runtime";
import { Analytics } from "@/services/analytics";
import { Database } from "@/services/database";
import { makeSeededDatabase } from "@/services/database.seeded-layer";
import { createCallerFactory, type Context } from "@/trpc";
import type { AppRouter } from "@/trpc/router";

export type Actor = { readonly id: string; readonly role: "admin" | "user" };

const ADMIN_ACTOR: Actor = { id: "seed-admin", role: "admin" };

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

export const startSeededApp = (router: AppRouter, scenario: ScenarioName) => {
  const events: AnalyticsEvent[] = [];
  const analytics = Layer.succeed(Analytics, {
    capture: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
    identify: () => Effect.void,
  });
  const bucket = makeFakeBucket();
  const layer = Layer.mergeAll(
    UserRepository.Default,
    AnalyticsRepository.Default,
    HealthRepository.Default,
    UploadRepository.Default,
    AccountRepository.Default,
  ).pipe(
    Layer.provideMerge(bucket.layer),
    Layer.provideMerge(makeSeededDatabase(scenario)),
    Layer.provideMerge(analytics),
  );
  const runtime = ManagedRuntime.make(layer);
  disposers.push(() => runtime.dispose());

  const callerAs = (actor: Actor | null = ADMIN_ACTOR) =>
    createCallerFactory(router)({
      headers: new Headers(),
      runtime: runtime as unknown as AppRuntime,
      auth: actor === null ? null : { session: { id: `session-${actor.id}` }, user: actor },
    } as unknown as Context);

  const exec = (statement: SQL) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database;
        yield* Effect.promise(() => Promise.resolve(db.run(statement)));
      }),
    );

  const rows = <T>(statement: SQL) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database;
        const result = yield* Effect.promise(() => Promise.resolve(db.all(statement)));
        return result as T[];
      }),
    );

  return { callerAs, events, exec, rows, bucket };
};

export type SeededApp = ReturnType<typeof startSeededApp>;
export type AppCaller = ReturnType<SeededApp["callerAs"]>;
