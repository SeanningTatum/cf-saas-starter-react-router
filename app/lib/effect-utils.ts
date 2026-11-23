import { Effect } from "effect";
import {
  QueryError,
  UpdateError,
  CreationError,
  DeletionError,
  NotFoundError,
} from "@/models/errors/repository";

const dbSpan = (op: string, entity: string) =>
  Effect.withSpan(`db.${op} ${entity}`, {
    kind: "client",
    attributes: { "db.operation": op, "db.entity": entity },
  });

export const tryQuery = <A>(entity: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new QueryError({ entity, cause }),
  }).pipe(dbSpan("query", entity));

export const tryUpdate = <A>(entity: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new UpdateError({ entity, cause }),
  }).pipe(dbSpan("update", entity));

export const tryCreate = <A>(entity: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new CreationError({ entity, cause }),
  }).pipe(dbSpan("create", entity));

export const tryDelete = <A>(entity: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new DeletionError({ entity, cause }),
  }).pipe(dbSpan("delete", entity));

export const requireFoundOrFail = <A, E>(
  value: A | null | undefined,
  onMissing: () => E,
): Effect.Effect<A, E> =>
  value === null || value === undefined ? Effect.fail(onMissing()) : Effect.succeed(value);

export const requireFound = <A>(
  entity: string,
  identifier: string,
  value: A | null | undefined,
): Effect.Effect<A, NotFoundError> =>
  requireFoundOrFail(value, () => new NotFoundError({ entity, identifier }));
