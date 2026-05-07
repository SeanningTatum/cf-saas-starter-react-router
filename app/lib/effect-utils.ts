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

export const requireFound = <A>(
  entity: string,
  identifier: string,
  value: A | null | undefined
): Effect.Effect<A, NotFoundError> =>
  value === null || value === undefined
    ? Effect.fail(new NotFoundError({ entity, identifier }))
    : Effect.succeed(value);
