import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { CloudflareEnv, CloudflareEnvLive } from "../cloudflare";

describe("CloudflareEnvLive", () => {
  it.effect("provides the supplied env verbatim", () =>
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      expect(env.BETTER_AUTH_SECRET).toBe("test-secret");
    }).pipe(
      Effect.provide(
        CloudflareEnvLive({ BETTER_AUTH_SECRET: "test-secret" } as Env)
      )
    )
  );
});
