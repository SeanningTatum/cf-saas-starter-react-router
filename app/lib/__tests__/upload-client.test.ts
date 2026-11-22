import { afterEach, describe, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { UPLOAD_ENDPOINT, uploadFile } from "../upload-client";

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
  // Catches: the helper posting to the wrong place or dropping the file part.
  it.effect("POSTs the file as multipart form data to the upload route", () =>
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

  // Catches: losing the key the success panel shows.
  it.effect("returns the stored key on success", () =>
    Effect.gen(function* () {
      replyWith(JSON.stringify({ success: true, key: "uploads/abc.png" }));
      expect(yield* uploadFile(file())).toEqual({ key: "uploads/abc.png" });
    })
  );

  // Catches: a 400 from the route turning into a generic error and hiding the
  // route's reason (e.g. "File content does not match its declared type").
  it.effect("fails with the route's message when the route refuses the file", () =>
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

  // Catches: a network failure escaping as a rejected promise instead of a value.
  it.effect("fails with ExternalServiceError when fetch rejects", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
      const result = yield* Effect.either(uploadFile(file()));
      expect(Either.isLeft(result) && result.left._tag).toBe("ExternalServiceError");
    })
  );

  // Catches: an HTML error page (e.g. a proxy 502) crashing the JSON parse.
  it.effect("fails with ExternalServiceError when the body is not JSON", () =>
    Effect.gen(function* () {
      replyWith("<html>Bad gateway</html>", 502);
      const result = yield* Effect.either(uploadFile(file()));
      expect(Either.isLeft(result) && result.left._tag).toBe("ExternalServiceError");
    })
  );

  // Catches: trusting a reply that is JSON but not the route's shape.
  it.effect("fails with ExternalServiceError when the JSON has the wrong shape", () =>
    Effect.gen(function* () {
      replyWith(JSON.stringify({ ok: true }));
      const result = yield* Effect.either(uploadFile(file()));
      expect(Either.isLeft(result) && result.left._tag).toBe("ExternalServiceError");
    })
  );
});
