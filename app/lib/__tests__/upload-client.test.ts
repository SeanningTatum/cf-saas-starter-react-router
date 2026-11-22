import { afterEach, describe, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { UPLOAD_ENDPOINT, uploadFile } from "../upload-client";
import {
  HTTP_TOO_MANY_REQUESTS,
  UPLOAD_RATE_LIMITED_MESSAGE,
} from "@/lib/constants/rate-limit";

const file = () => new File(["hello"], "hello.txt", { type: "text/plain" });

const replyWith = (body: BodyInit, status = 200) => {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFile", () => {
  it.effect("POSTs the file as multipart form data to the upload route, not to another place and with the file part kept", () =>
    Effect.gen(function* () {
      const fetchMock = replyWith(JSON.stringify({ success: true, key: "k1" }));
      const picked = file();

      yield* uploadFile(picked);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(UPLOAD_ENDPOINT);
      expect(init.method).toBe("POST");
      expect((init.body as FormData).get("file")).toBe(picked);
    })
  );

  it.effect("returns the stored key on success, so the success panel can show it", () =>
    Effect.gen(function* () {
      replyWith(JSON.stringify({ success: true, key: "uploads/abc.png" }));
      expect(yield* uploadFile(file())).toEqual({ key: "uploads/abc.png" });
    })
  );

  it.effect("fails with the route's message when the route refuses the file, so a 400 does not become a generic error that hides the reason", () =>
    Effect.gen(function* () {
      replyWith(JSON.stringify({ success: false, error: "Too big" }), 400);
      const result = yield* Effect.either(uploadFile(file()));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("BucketValidationError");
        expect(result.left).toMatchObject({ message: "Too big" });
      }
    })
  );

  it.effect("shows the wait message when the route answers 429, rather than a generic failure", () =>
    Effect.gen(function* () {
      replyWith(
        JSON.stringify({ success: false, error: UPLOAD_RATE_LIMITED_MESSAGE }),
        HTTP_TOO_MANY_REQUESTS
      );
      const result = yield* Effect.either(uploadFile(file()));
      expect(result).toEqual(
        Either.left(expect.objectContaining({ _tag: "BucketValidationError", message: UPLOAD_RATE_LIMITED_MESSAGE }))
      );
    })
  );

  it.effect("fails with ExternalServiceError when fetch rejects, so a network failure is a value and not a rejected promise", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
      const result = yield* Effect.either(uploadFile(file()));
      expect(Either.isLeft(result) && result.left._tag).toBe("ExternalServiceError");
    })
  );

  it.effect("fails with ExternalServiceError when the body is not JSON, so an HTML error page such as a proxy 502 cannot crash the JSON parse", () =>
    Effect.gen(function* () {
      replyWith("<html>Bad gateway</html>", 502);
      const result = yield* Effect.either(uploadFile(file()));
      expect(Either.isLeft(result) && result.left._tag).toBe("ExternalServiceError");
    })
  );

  it.effect("fails with ExternalServiceError when the JSON has the wrong shape, so a reply that is JSON but not the route shape is not trusted", () =>
    Effect.gen(function* () {
      replyWith(JSON.stringify({ ok: true }));
      const result = yield* Effect.either(uploadFile(file()));
      expect(Either.isLeft(result) && result.left._tag).toBe("ExternalServiceError");
    })
  );
});
