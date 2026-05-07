import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Exit, Cause } from "effect";
import { BucketRepository } from "../bucket";
import { Bucket } from "@/services/bucket";
import {
  BucketUploadError,
  BucketGetError,
  BucketDeleteError,
  BucketListError,
} from "@/models/errors/bucket";

const makeBucketLayer = (stub: unknown): Layer.Layer<Bucket> =>
  Layer.succeed(Bucket, { bucket: stub as R2Bucket });

const provideStub = (stub: unknown) =>
  BucketRepository.Default.pipe(Layer.provide(makeBucketLayer(stub)));

describe("BucketRepository.upload", () => {
  it.effect("uploads string and returns generated key", () => {
    let putKey: string | undefined;
    const stub = {
      put: async (key: string) => {
        putKey = key;
      },
    };
    return Effect.gen(function* () {
      const repo = yield* BucketRepository;
      const key = yield* repo.upload("hello");
      expect(typeof key).toBe("string");
      expect(key).toBe(putKey);
      expect(key.startsWith("uploads/")).toBe(true);
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("respects provided key", () => {
    const stub = { put: async () => {} };
    return Effect.gen(function* () {
      const repo = yield* BucketRepository;
      const key = yield* repo.upload("x", { key: "custom/key.txt" });
      expect(key).toBe("custom/key.txt");
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("wraps put failure as BucketUploadError", () => {
    const stub = {
      put: async () => {
        throw new Error("boom");
      },
    };
    return Effect.gen(function* () {
      const repo = yield* BucketRepository;
      const exit = yield* Effect.exit(repo.upload("x", { key: "k" }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(BucketUploadError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("BucketRepository.get", () => {
  it.effect("wraps get failure as BucketGetError", () => {
    const stub = {
      get: async () => {
        throw new Error("read fail");
      },
    };
    return Effect.gen(function* () {
      const repo = yield* BucketRepository;
      const exit = yield* Effect.exit(repo.get("k"));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(BucketGetError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("returns object on success", () => {
    const stub = { get: async () => ({ body: "data" }) };
    return Effect.gen(function* () {
      const repo = yield* BucketRepository;
      const result = yield* repo.get("k");
      expect(result).toEqual({ body: "data" });
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("BucketRepository.remove", () => {
  it.effect("wraps delete failure as BucketDeleteError", () => {
    const stub = {
      delete: async () => {
        throw new Error("del fail");
      },
    };
    return Effect.gen(function* () {
      const repo = yield* BucketRepository;
      const exit = yield* Effect.exit(repo.remove("k"));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(BucketDeleteError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("BucketRepository.list", () => {
  it.effect("wraps list failure as BucketListError", () => {
    const stub = {
      list: async () => {
        throw new Error("list fail");
      },
    };
    return Effect.gen(function* () {
      const repo = yield* BucketRepository;
      const exit = yield* Effect.exit(repo.list({ limit: 1000 }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(BucketListError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("uses default limit when input omitted", () => {
    let listOpts: { prefix?: string; limit?: number } | undefined;
    const stub = {
      list: async (opts: { prefix?: string; limit?: number }) => {
        listOpts = opts;
        return { objects: [] };
      },
    };
    return Effect.gen(function* () {
      const repo = yield* BucketRepository;
      yield* repo.list();
      expect(listOpts?.limit).toBe(1000);
    }).pipe(Effect.provide(provideStub(stub)));
  });
});
