import { Schema } from "effect";

export const UploadOptions = Schema.Struct({
  key: Schema.optional(Schema.String),
  contentType: Schema.optional(Schema.String),
});
export type UploadOptions = typeof UploadOptions.Type;

export const ListR2Input = Schema.Struct({
  prefix: Schema.optional(Schema.String),
  limit: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(1000),
    Schema.optionalWith({ default: () => 1000 })
  ),
});
export type ListR2Input = typeof ListR2Input.Type;
