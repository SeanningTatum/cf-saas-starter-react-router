import { afterEach, describe, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { posthogAdapter } from "../posthog";
import type { CapturedEvent } from "../../adapter";
import { AnalyticsDeliveryError } from "@/models/errors/analytics";

const sample: CapturedEvent = {
  event: "user_banned",
  distinctId: "admin-1",
  properties: { targetUserId: "u-9" },
  timestamp: "2026-01-01T00:00:00.000Z",
};

const stubFetch = (impl: () => Promise<{ ok: boolean; status: number }>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("posthogAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.effect("posts one {api_key, batch} body with snake_case keys, to the US cloud by default", () =>
    Effect.gen(function* () {
      // Catches: wrong endpoint, distinctId sent un-renamed, or one request per event.
      const fetchFn = stubFetch(async () => ({ ok: true, status: 200 }));
      yield* posthogAdapter({ apiKey: "phc_x" }).send([sample, { ...sample, event: "b" }]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://us.i.posthog.com/batch/");
      expect(JSON.parse(init.body as string)).toEqual({
        api_key: "phc_x",
        batch: [
          { event: "user_banned", distinct_id: "admin-1", properties: { targetUserId: "u-9" }, timestamp: sample.timestamp },
          { event: "b", distinct_id: "admin-1", properties: { targetUserId: "u-9" }, timestamp: sample.timestamp },
        ],
      });
    })
  );

  it.effect("fails with AnalyticsDeliveryError on a non-2xx status or a rejected fetch", () =>
    Effect.gen(function* () {
      // Catches: a 401/500 treated as success, or a network error escaping untyped.
      stubFetch(async () => ({ ok: false, status: 503 }));
      const bad = yield* Effect.flip(posthogAdapter({ apiKey: "k" }).send([sample]));
      expect(bad).toBeInstanceOf(AnalyticsDeliveryError);
      expect(bad.status).toBe(503);

      stubFetch(() => Promise.reject(new Error("offline")));
      const down = yield* Effect.flip(posthogAdapter({ apiKey: "k" }).send([sample]));
      expect(down).toBeInstanceOf(AnalyticsDeliveryError);
    })
  );
});
