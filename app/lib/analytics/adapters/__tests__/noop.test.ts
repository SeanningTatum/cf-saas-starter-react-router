import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { noopAdapter } from "../noop";

describe("noopAdapter", () => {
  it.effect(
    "accepts a batch and succeeds, so the default provider (none) never fails or logs on every request",
    () =>
      Effect.gen(function* () {
        yield* noopAdapter.send([{ event: "e", distinctId: "d", properties: {}, timestamp: "t" }]);
        expect(noopAdapter.name).toBe("none");
      }),
  );
});
