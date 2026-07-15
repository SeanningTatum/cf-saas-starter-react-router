import { describe, it, expect } from "vitest";
import type { AppLoadContext } from "react-router";
import {
  requireSession,
  requireAdmin,
  redirectIfAuthenticated,
} from "../session";

const makeContext = (session: unknown): AppLoadContext =>
  ({
    auth: {
      api: {
        getSession: async () => session,
      },
    },
  }) as unknown as AppLoadContext;

const request = () => new Request("http://localhost/");

async function expectRedirect(promise: Promise<unknown>, location: string) {
  try {
    await promise;
    expect.fail("expected a redirect to be thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    const response = error as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(location);
  }
}

describe("requireSession", () => {
  it("returns the session when present", async () => {
    const session = { session: {}, user: { id: "u1", role: "user" } };
    const result = await requireSession(request(), makeContext(session));
    expect(result).toBe(session);
  });

  it("redirects to /login when there is no session", async () => {
    await expectRedirect(
      requireSession(request(), makeContext(null)),
      "/login"
    );
  });
});

describe("requireAdmin", () => {
  it("returns the session when the user is an admin", async () => {
    const session = { session: {}, user: { id: "u1", role: "admin" } };
    const result = await requireAdmin(request(), makeContext(session));
    expect(result).toBe(session);
  });

  it("redirects to /dashboard when the user is not an admin", async () => {
    const session = { session: {}, user: { id: "u1", role: "user" } };
    await expectRedirect(
      requireAdmin(request(), makeContext(session)),
      "/dashboard"
    );
  });

  it("redirects to /login when there is no session", async () => {
    await expectRedirect(
      requireAdmin(request(), makeContext(null)),
      "/login"
    );
  });
});

describe("redirectIfAuthenticated", () => {
  it("redirects to /dashboard by default when a session exists", async () => {
    const session = { session: {}, user: { id: "u1", role: "user" } };
    await expectRedirect(
      redirectIfAuthenticated(request(), makeContext(session)),
      "/dashboard"
    );
  });

  it("redirects to a custom destination", async () => {
    const session = { session: {}, user: { id: "u1", role: "user" } };
    await expectRedirect(
      redirectIfAuthenticated(request(), makeContext(session), "/somewhere"),
      "/somewhere"
    );
  });

  it("does nothing when there is no session", async () => {
    await expect(
      redirectIfAuthenticated(request(), makeContext(null))
    ).resolves.toBeUndefined();
  });
});
