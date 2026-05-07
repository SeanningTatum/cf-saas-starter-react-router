import { Data } from "effect";

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly entity: string;
  readonly identifier: string;
}> {}

export class CreationError extends Data.TaggedError("CreationError")<{
  readonly entity: string;
  readonly cause?: unknown;
}> {}

export class UpdateError extends Data.TaggedError("UpdateError")<{
  readonly entity: string;
  readonly cause?: unknown;
}> {}

export class DeletionError extends Data.TaggedError("DeletionError")<{
  readonly entity: string;
  readonly cause?: unknown;
}> {}

export class QueryError extends Data.TaggedError("QueryError")<{
  readonly entity: string;
  readonly cause?: unknown;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly entity: string;
  readonly message: string;
  readonly field?: string;
}> {}

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly service: string;
  readonly field?: string;
}> {}

export class ExternalServiceError extends Data.TaggedError(
  "ExternalServiceError"
)<{
  readonly service: string;
  readonly cause?: unknown;
}> {}

export type RepositoryError =
  | NotFoundError
  | CreationError
  | UpdateError
  | DeletionError
  | QueryError
  | ValidationError
  | ConfigurationError
  | ExternalServiceError;
