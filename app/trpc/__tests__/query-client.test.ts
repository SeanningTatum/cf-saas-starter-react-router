import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import { makeQueryClient } from "../query-client";

const THIRTY_SECONDS_MS = 30_000;

const fillCache = async (client: QueryClient) => {
  void client.prefetchQuery({
    queryKey: ["pending"],
    queryFn: () => new Promise<never>(() => undefined),
  });
  await client.prefetchQuery({ queryKey: ["success"], queryFn: () => Promise.resolve("ok") });
  await client.prefetchQuery({
    queryKey: ["error"],
    queryFn: () => Promise.reject(new Error("boom")),
    retry: false,
  });
};

const queryOf = (client: QueryClient, key: string) => {
  const query = client.getQueryCache().find({ queryKey: [key] });
  if (query === undefined) throw new Error(`no query cached under ${key}`);
  return query;
};

describe("makeQueryClient", () => {
  it("sets a 30 second staleTime, so that a page served from SSR does not refetch every query the moment it hydrates", () => {
    expect(makeQueryClient().getDefaultOptions().queries?.staleTime).toBe(THIRTY_SECONDS_MS);
  });

  it("dehydrates pending and successful queries but not errored ones, so that a streamed query reaches the client while a server error is retried there instead of frozen into the HTML", async () => {
    const client = makeQueryClient();
    await fillCache(client);
    const shouldDehydrate = client.getDefaultOptions().dehydrate?.shouldDehydrateQuery;
    if (shouldDehydrate === undefined) throw new Error("shouldDehydrateQuery is not set");

    expect(queryOf(client, "pending").state.status).toBe("pending");
    expect(queryOf(client, "error").state.status).toBe("error");
    expect(shouldDehydrate(queryOf(client, "pending"))).toBe(true);
    expect(shouldDehydrate(queryOf(client, "success"))).toBe(true);
    expect(shouldDehydrate(queryOf(client, "error"))).toBe(false);

    const keys = dehydrate(client).queries.map((query) => query.queryKey[0]);
    expect(keys.sort()).toEqual(["pending", "success"]);
  });

  it("deserializes hydrated data with superjson, so that a Date sent from the server arrives as a Date and not a string", () => {
    const sentAt = new Date("2026-01-02T03:04:05.000Z");
    const server = new QueryClient();
    server.setQueryData(["when"], superjson.serialize({ sentAt }));
    const client = makeQueryClient();
    hydrate(client, dehydrate(server));

    const received = client.getQueryData<{ sentAt: unknown }>(["when"]);
    expect(received?.sentAt).toBeInstanceOf(Date);
    expect(received?.sentAt).toEqual(sentAt);
  });

  it("returns a new client on each call, so that two server requests never share one cache", () => {
    const first = makeQueryClient();
    const second = makeQueryClient();
    expect(first).not.toBe(second);
    first.setQueryData(["user"], "alice");
    expect(second.getQueryData(["user"])).toBeUndefined();
  });
});
