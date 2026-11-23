import { Schema } from "effect";
import { R2_MAX_KEY_LENGTH } from "@/lib/constants/upload";

const R2Key = Schema.String.pipe(Schema.maxLength(R2_MAX_KEY_LENGTH));

export const UploadOptions = Schema.Struct({
  key: Schema.optional(R2Key),
  contentType: Schema.optional(Schema.String.pipe(Schema.maxLength(255))),
});
export type UploadOptions = typeof UploadOptions.Type;

export const ListR2Input = Schema.Struct({
  prefix: Schema.optional(R2Key),
  cursor: Schema.optional(Schema.String),
  limit: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(1000),
    Schema.optionalWith({ default: () => 1000 }),
  ),
});
export type ListR2Input = typeof ListR2Input.Type;
