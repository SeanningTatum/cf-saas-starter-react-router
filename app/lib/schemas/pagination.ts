import { Schema } from "effect";

export const PaginationInput = Schema.Struct({
  page: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0),
    Schema.optionalWith({ default: () => 0 }),
  ),
  limit: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(100),
    Schema.optionalWith({ default: () => 10 }),
  ),
});

export type PaginationInput = typeof PaginationInput.Type;
