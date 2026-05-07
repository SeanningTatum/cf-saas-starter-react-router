import { Data } from "effect";

export class BucketBindingError extends Data.TaggedError("BucketBindingError")<{
  readonly message?: string;
}> {}

export class BucketUploadError extends Data.TaggedError("BucketUploadError")<{
  readonly cause?: unknown;
}> {}

export class BucketGetError extends Data.TaggedError("BucketGetError")<{
  readonly cause?: unknown;
}> {}

export class BucketNotFoundError extends Data.TaggedError(
  "BucketNotFoundError"
)<{
  readonly key: string;
}> {}

export class BucketDeleteError extends Data.TaggedError("BucketDeleteError")<{
  readonly cause?: unknown;
}> {}

export class BucketListError extends Data.TaggedError("BucketListError")<{
  readonly cause?: unknown;
}> {}

export class BucketValidationError extends Data.TaggedError(
  "BucketValidationError"
)<{
  readonly message: string;
  readonly field?: string;
}> {}

export type BucketError =
  | BucketBindingError
  | BucketUploadError
  | BucketGetError
  | BucketNotFoundError
  | BucketDeleteError
  | BucketListError
  | BucketValidationError;
