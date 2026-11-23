import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { AppLoadContext } from "react-router";
import { action, loader } from "../upload-object";
import { UploadRepository } from "@/repositories/upload";
import { makeFakeBucket } from "@/services/__tests__/fake-bucket";
import { makeSeededDatabase } from "@/services/database.seeded-layer";
import { DOWNLOAD_HEADERS } from "@/lib/constants/upload";

const OWNER = "seed-user";
const OTHER = "seed-banned";

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];
type Refusal = {
  readonly data: { readonly success: boolean };
  readonly init: ResponseInit | null;
};

const runtimes: Array<{ dispose: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

const setup = () => {
  const bucket = makeFakeBucket();
  const layer = UploadRepository.Default.pipe(
    Layer.provideMerge(bucket.layer),
    Layer.provideMerge(makeSeededDatabase("base")),
  );
  const runtime = ManagedRuntime.make(layer);
  runtimes.push(runtime);
  const contextFor = (userId: string | null): AppLoadContext =>
    ({
      runtime,
      reportError: vi.fn(),
      auth: {
        api: {
          getSession: async () =>
            userId === null ? null : { user: { id: userId, banned: false, banExpires: null } },
        },
      },
    }) as unknown as AppLoadContext;
  const store = (userId: string) =>
    runtime.runPromise(
      Effect.flatMap(UploadRepository, (repo) =>
        repo.store({
          userId,
          file: new File([new Uint8Array([1, 2, 3])], "a.png", {
            type: "image/png",
          }),
          contentType: "image/png",
        }),
      ),
    );
  const get = (userId: string | null, id: string) =>
    loader({
      request: new Request(`https://app.example.com/api/uploads/${id}`),
      context: contextFor(userId),
      params: { id },
    } as unknown as LoaderArgs);
  const remove = (userId: string | null, id: string, method = "DELETE") =>
    action({
      request: new Request(`https://app.example.com/api/uploads/${id}`, {
        method,
      }),
      context: contextFor(userId),
      params: { id },
    } as unknown as ActionArgs);
  return { bucket, store, get, remove };
};

const statusOf = (result: unknown) => (result as Refusal).init?.status;

describe("GET /api/uploads/:id", () => {
  it("serves the owner's file as an attachment with the stored type and no sniffing", async () => {
    const { store, get } = setup();
    const { id } = await store(OWNER);

    const response = (await get(OWNER, id)) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      DOWNLOAD_HEADERS["content-disposition"],
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers 404 for another user's upload id, so a user cannot read or probe another's file", async () => {
    const { store, get } = setup();
    const { id } = await store(OWNER);

    expect(statusOf(await get(OTHER, id))).toBe(404);
  });

  it("answers 404 for an id that does not exist, the same as for another user's", async () => {
    const { get } = setup();
    expect(statusOf(await get(OWNER, "no-such-id"))).toBe(404);
  });

  it("answers 401 for a signed-out caller", async () => {
    const { store, get } = setup();
    const { id } = await store(OWNER);

    expect(statusOf(await get(null, id))).toBe(401);
  });

  it("answers 404 when the row exists but the object is gone", async () => {
    const { bucket, store, get } = setup();
    const { id, key } = await store(OWNER);
    bucket.drop(key);

    expect(statusOf(await get(OWNER, id))).toBe(404);
  });
});

describe("DELETE /api/uploads/:id", () => {
  it("refuses another user's delete with 404 and keeps the object", async () => {
    const { bucket, store, remove } = setup();
    const { id, key } = await store(OWNER);

    expect(statusOf(await remove(OTHER, id))).toBe(404);
    expect(bucket.keys()).toContain(key);
  });

  it("deletes the owner's object and row, then answers 404 for the same id", async () => {
    const { bucket, store, remove } = setup();
    const { id, key } = await store(OWNER);

    const result = (await remove(OWNER, id)) as { success: boolean };

    expect(result).toEqual({ success: true });
    expect(bucket.keys()).not.toContain(key);
    expect(statusOf(await remove(OWNER, id))).toBe(404);
  });

  it("answers 401 for a signed-out caller and refuses a method other than DELETE", async () => {
    const { store, remove } = setup();
    const { id } = await store(OWNER);

    expect(statusOf(await remove(null, id))).toBe(401);
    expect(statusOf(await remove(OWNER, id, "POST"))).toBe(404);
  });
});
