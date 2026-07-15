import { Effect } from "effect";
import {
  QueryError,
  UpdateError,
  CreationError,
  DeletionError,
  NotFoundError,
} from "@/models/errors/repository";

export const tryQuery = <A>(entity: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new QueryError({ entity, cause }),
  });

export const tryUpdate = <A>(entity: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new UpdateError({ entity, cause }),
  });

export const tryCreate = <A>(entity: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new CreationError({ entity, cause }),
  });

export const tryDelete = <A>(entity: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new DeletionError({ entity, cause }),
  });

/**
 * Generic "value or fail" — lets callers outside the generic repository
 * error family (e.g. Bucket*Error) build their own not-found tagged error.
 */
export const requireFoundOrFail = <A, E>(
  value: A | null | undefined,
  onMissing: () => E
): Effect.Effect<A, E> =>
  value === null || value === undefined
    ? Effect.fail(onMissing())
    : Effect.succeed(value);

export const requireFound = <A>(
  entity: string,
  identifier: string,
  value: A | null | undefined
): Effect.Effect<A, NotFoundError> =>
  requireFoundOrFail(value, () => new NotFoundError({ entity, identifier }));
