import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { checkSandboxEnabled } from "../gate";

const outcome = (env: { SANDBOX_ENABLED?: string }, built: boolean) =>
  Effect.runSync(
    Effect.either(checkSandboxEnabled(env, built)).pipe(
      Effect.map(Either.match({ onLeft: (error) => error.reason, onRight: () => "open" as const })),
    ),
  );

describe("checkSandboxEnabled", () => {
  it.each([
    { built: true, flag: "1", expected: "open" },
    { built: true, flag: undefined, expected: "flag-off" },
    { built: false, flag: "1", expected: "not-built" },
    { built: false, flag: undefined, expected: "not-built" },
  ])(
    "build flag $built with SANDBOX_ENABLED=$flag gives $expected: it opens only when both say so",
    ({ built, flag, expected }) => {
      expect(outcome(flag === undefined ? {} : { SANDBOX_ENABLED: flag }, built)).toBe(expected);
    },
  );

  it.each(["0", "true", "yes", " 1", ""])(
    "stays shut for SANDBOX_ENABLED=%j, so only the exact value the build sets opens it",
    (flag) => {
      expect(outcome({ SANDBOX_ENABLED: flag }, true)).toBe("flag-off");
    },
  );
});
