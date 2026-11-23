import { Layer } from "effect";
import { Bucket } from "@/services/bucket";

interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string | undefined;
}

export interface FakeBucket {
  readonly layer: Layer.Layer<Bucket>;
  readonly keys: () => string[];
  readonly failPut: (on: boolean) => void;
  readonly onPut: (hook: () => PromiseLike<unknown>) => void;
  readonly pageSize: (size: number) => void;
  readonly seed: (key: string) => void;
  readonly drop: (key: string) => void;
}

const asList = (keys: string | string[]): string[] => (typeof keys === "string" ? [keys] : keys);

export const makeFakeBucket = (): FakeBucket => {
  const objects = new Map<string, StoredObject>();
  let failingPut = false;
  let afterPut: (() => PromiseLike<unknown>) | undefined;
  let maxPage = Number.POSITIVE_INFINITY;
  const bucket = {
    put: async (
      key: string,
      value: ArrayBuffer | string,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      if (failingPut) throw new Error("put refused");
      const body =
        typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
      objects.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType,
      });
      await afterPut?.();
    },
    get: async (key: string) => {
      const found = objects.get(key);
      return found ? { body: new Blob([found.body as BlobPart]).stream(), key } : null;
    },
    delete: async (keys: string | string[]) => {
      for (const key of asList(keys)) objects.delete(key);
    },
    list: async ({
      prefix,
      limit,
      cursor,
    }: {
      prefix?: string;
      limit?: number;
      cursor?: string;
    }) => {
      const matching = [...objects.keys()]
        .sort()
        .filter((key) => prefix === undefined || key.startsWith(prefix));
      const start = cursor === undefined ? 0 : Number(cursor);
      const end = start + Math.min(limit ?? matching.length, maxPage);
      const truncated = end < matching.length;
      return {
        objects: matching.slice(start, end).map((key) => ({ key })),
        truncated,
        cursor: truncated ? String(end) : undefined,
      };
    },
  };
  return {
    layer: Layer.succeed(Bucket, { bucket: bucket as unknown as R2Bucket }),
    keys: () => [...objects.keys()].sort(),
    onPut: (hook) => {
      afterPut = hook;
    },
    pageSize: (size) => {
      maxPage = size;
    },
    failPut: (on) => {
      failingPut = on;
    },
    drop: (key) => {
      objects.delete(key);
    },
    seed: (key) => {
      objects.set(key, { body: new Uint8Array([1]), contentType: undefined });
    },
  };
};
