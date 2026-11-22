import { describe, it, expect } from "vitest";
import { Layer, ManagedRuntime } from "effect";
import type { AppLoadContext } from "react-router";
import {
  requireSession,
  requireAdmin,
  redirectIfAuthenticated,
} from "../session";
import { classifyError } from "@/lib/error-reporting/classify";
import { AUTH_GET_SESSION_SPAN } from "@/lib/constants/spans";
import { makeOtlpTracer, makeSpanBuffer } from "@/services/tracing";

const makeContext = (session: unknown): AppLoadContext =>
  ({
    auth: {
      api: {
        getSession: async () => session,
      },
    },
    runtime: ManagedRuntime.make(Layer.empty),
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

describe("requireSession through the request runtime", () => {
  const tracedContext = (getSession: () => Promise<unknown>) => {
    const buffer = makeSpanBuffer();
    const context = {
      auth: { api: { getSession } },
      runtime: ManagedRuntime.make(Layer.setTracer(makeOtlpTracer(buffer))),
    } as unknown as AppLoadContext;
    return { buffer, context };
  };

  it("runs the lookup in context.runtime and still redirects to /login with no session, so a page's session check is traced", async () => {
    const { buffer, context } = tracedContext(async () => null);

    await expectRedirect(requireSession(request(), context), "/login");

    expect(buffer.spans.map((span) => span.name)).toEqual([AUTH_GET_SESSION_SPAN]);
  });

  it("rejects with a failure that classifies as an expected ExternalServiceError when the lookup throws, so an auth outage is not filed as a crash", async () => {
    const { context } = tracedContext(async () => {
      throw new Error("auth down");
    });

    const rejection = await requireSession(request(), context).then(
      () => expect.fail("expected requireSession to reject"),
      (error: unknown) => error
    );

    expect(rejection).not.toBeInstanceOf(Response);
    expect(classifyError(rejection)).toMatchObject({
      kind: "expected",
      tag: "ExternalServiceError",
    });
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

  it("lets in a user whose role list includes admin, the same reading as the admin guard", async () => {
    const session = { session: {}, user: { id: "u1", role: "user, admin" } };
    expect(await requireAdmin(request(), makeContext(session))).toBe(session);
  });

  it("keeps out a role that only starts with admin", async () => {
    const session = { session: {}, user: { id: "u1", role: "administrator" } };
    await expectRedirect(requireAdmin(request(), makeContext(session)), "/dashboard");
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

describe("a user whose ban is active is treated as signed out", () => {
  const LONG_AGO = new Date("2000-01-01T00:00:00Z");
  const FAR_AHEAD = new Date("2999-01-01T00:00:00Z");
  const banned = (role: string, banExpires: Date | null = null) => ({
    session: {},
    user: { id: "u1", role, banned: true, banExpires },
  });

  it("requireSession sends a banned user to /login", async () => {
    await expectRedirect(requireSession(request(), makeContext(banned("user"))), "/login");
    await expectRedirect(
      requireSession(request(), makeContext(banned("user", FAR_AHEAD))),
      "/login"
    );
  });

  it("requireAdmin sends a banned admin to /login, not into the admin area", async () => {
    await expectRedirect(requireAdmin(request(), makeContext(banned("admin"))), "/login");
  });

  it("redirectIfAuthenticated lets a banned user see the public page", async () => {
    await expect(
      redirectIfAuthenticated(request(), makeContext(banned("user")))
    ).resolves.toBeUndefined();
  });

  it("requireSession lets a user through once the ban has run out", async () => {
    const expired = banned("user", LONG_AGO);
    expect(await requireSession(request(), makeContext(expired))).toBe(expired);
  });
});
