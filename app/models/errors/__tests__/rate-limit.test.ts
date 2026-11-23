import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import { RateLimitError } from "../rate-limit";

describe("RateLimitError", () => {
  it("carries its tag, rule and wait, so catchTag and the 429 response can read them", () => {
    const error = new RateLimitError({ rule: "signIn", retryAfterSeconds: 60 });
    expect(error._tag).toBe("RateLimitError");
    expect(error).toMatchObject({ rule: "signIn", retryAfterSeconds: 60 });
  });

  it("is caught by its tag and no other", () => {
    const caught = Effect.runSync(
      Effect.either(
        Effect.fail(new RateLimitError({ rule: "upload", retryAfterSeconds: 60 })).pipe(
          Effect.catchTag("RateLimitError", (error) => Effect.succeed(error.rule)),
        ),
      ),
    );
    expect(caught).toEqual(Either.right("upload"));
  });
});
