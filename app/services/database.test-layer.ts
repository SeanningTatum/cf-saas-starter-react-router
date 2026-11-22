import { Layer } from "effect";
import { vi } from "vitest";
import type { DrizzleD1, DatabaseShape } from "./database";
import { Database } from "./database";

export const makeTestDatabase = (stub: unknown): Layer.Layer<Database> =>
  Layer.succeed(Database, { db: stub as DrizzleD1 } as DatabaseShape);

export const chainable = <T>(value: T) => {
  const target = Promise.resolve(value);
  const proxy: unknown = new Proxy(
    () => {},
    {
      get(_t, key) {
        if (key === "then") return target.then.bind(target);
        if (key === "catch") return target.catch.bind(target);
        if (key === "finally") return target.finally.bind(target);
        return () => proxy;
      },
      apply() {
        return proxy;
      },
    }
  );
  return proxy;
};

export const chainableSpy = <T>(value: T) => vi.fn(() => chainable(value));
