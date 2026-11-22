import { describe, expect, it, vi } from "vitest";
import type { GenericEndpointContext } from "better-auth";
import { session as sessionTable } from "@/db/schema";
import { chainableSpy } from "@/services/database.test-layer";
import { clearExpiryOnOpenBan, endSessionsOnBan, type SessionStore } from "../ban-hooks";

const LONG_AGO = new Date("2000-01-01T00:00:00Z");
const FAR_AHEAD = new Date("2999-01-01T00:00:00Z");

describe("clearExpiryOnOpenBan", () => {
  it("writes a null expiry for a ban that names none, so an old past expiry cannot end the new ban", async () => {
    expect(await clearExpiryOnOpenBan({ banned: true, banReason: "spam" })).toEqual({
      data: { banned: true, banReason: "spam", banExpires: null },
    });
  });

  it.each([
    ["a ban with its own expiry", { banned: true, banExpires: FAR_AHEAD }],
    ["a ban with an explicit null expiry", { banned: true, banExpires: null }],
    ["an unban", { banned: false }],
    ["an update that does not touch the ban", { name: "N" }],
  ])("leaves %s as sent", async (_label, data) => {
    expect(await clearExpiryOnOpenBan(data)).toBeUndefined();
  });
});

describe("endSessionsOnBan", () => {
  const storeSpy = () => {
    const del = chainableSpy(undefined);
    return { del, store: { delete: del } as unknown as SessionStore };
  };

  const endpointContext = () => {
    const deleteUserSessions = vi.fn(async (_userId: string) => undefined);
    const context = {
      context: { internalAdapter: { deleteUserSessions } },
    } as unknown as GenericEndpointContext;
    return { deleteUserSessions, context };
  };

  it("ends the user's sessions through Better Auth's own delete when an endpoint is running", async () => {
    const { del, store } = storeSpy();
    const { deleteUserSessions, context } = endpointContext();

    await endSessionsOnBan(store)({ id: "u1", banned: true }, context);

    expect(deleteUserSessions).toHaveBeenCalledWith("u1");
    expect(del).not.toHaveBeenCalled();
  });

  it("falls back to the session table when the hook fires outside an endpoint", async () => {
    const { del, store } = storeSpy();

    await endSessionsOnBan(store)({ id: "u1", banned: true, banExpires: FAR_AHEAD }, null);

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(sessionTable);
  });

  it.each([
    ["banned: false", { id: "u1", banned: false }],
    ["banned: null", { id: "u1", banned: null }],
    ["no banned field", { id: "u1" }],
    ["a ban that has run out", { id: "u1", banned: true, banExpires: LONG_AGO }],
  ])("leaves sessions alone on an update with %s", async (_label, user) => {
    const { del, store } = storeSpy();
    const { deleteUserSessions, context } = endpointContext();

    await endSessionsOnBan(store)(user, context);
    await endSessionsOnBan(store)(user, null);

    expect(deleteUserSessions).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("does nothing when the update returned no row", async () => {
    const { del, store } = storeSpy();
    await endSessionsOnBan(store)(null, null);
    expect(del).not.toHaveBeenCalled();
  });
});
