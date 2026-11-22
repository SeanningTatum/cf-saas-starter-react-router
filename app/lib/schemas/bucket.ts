import { Schema } from "effect";

// R2's key limit.
const R2Key = Schema.String.pipe(Schema.maxLength(1024));

export const UploadOptions = Schema.Struct({
  key: Schema.optional(R2Key),
  contentType: Schema.optional(Schema.String.pipe(Schema.maxLength(255))),
});
export type UploadOptions = typeof UploadOptions.Type;

export const ListR2Input = Schema.Struct({
  prefix: Schema.optional(R2Key),
  limit: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(1000),
    Schema.optionalWith({ default: () => 1000 }),
  ),
});
export type ListR2Input = typeof ListR2Input.Type;
