import { describe, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { consoleAdapter } from "../console";
import { loggers } from "@/lib/logger";

describe("consoleAdapter", () => {
  it.effect(
    "logs one line per event with the event attached, so the dev provider neither logs nothing nor one line for the whole batch",
    () =>
      Effect.gen(function* () {
        const info = vi.spyOn(loggers.server, "info").mockImplementation(() => {});
        const mk = (event: string) => ({
          event,
          distinctId: "d",
          properties: {},
          timestamp: "t",
        });
        yield* consoleAdapter.send([mk("a"), mk("b")]);
        expect(info).toHaveBeenCalledTimes(2);
        expect(info.mock.calls[0]?.[0]).toMatchObject({ analytics: { event: "a" } });
        info.mockRestore();
      }),
  );
});
