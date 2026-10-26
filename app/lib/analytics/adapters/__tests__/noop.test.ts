import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { noopAdapter } from "../noop";

describe("noopAdapter", () => {
  it.effect("accepts a batch and succeeds", () =>
    Effect.gen(function* () {
      // Catches: the default provider ("none") failing and logging on every request.
      yield* noopAdapter.send([
        { event: "e", distinctId: "d", properties: {}, timestamp: "t" },
      ]);
      expect(noopAdapter.name).toBe("none");
    })
  );
});
