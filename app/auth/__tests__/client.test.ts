import { afterEach, describe, expect, it, vi } from "vitest";
import { API_ROUTES } from "@/lib/constants/routes";

const ORIGIN = "https://app.example.com";

type Sent = { url: string; method: string };

const freshClient = async () => {
  const sent: Sent[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    sent.push({ url: request.url, method: request.method });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  vi.stubGlobal("fetch", fakeFetch);
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
  vi.resetModules();
  const { authClient } = await import("../client");
  return { authClient, sent };
};

describe("authClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends core auth calls under API_ROUTES.auth, so that a changed basePath cannot point the browser at a route the Worker does not serve", async () => {
    const { authClient, sent } = await freshClient();
    await authClient.signOut();
    expect(sent).toEqual([{ url: `${ORIGIN}${API_ROUTES.auth}/sign-out`, method: "POST" }]);
  });

  it("carries the admin plugin's path methods, so that dropping adminClient() turns stop-impersonating into a GET the server rejects", async () => {
    const { authClient, sent } = await freshClient();
    await authClient.admin.stopImpersonating();
    expect(sent).toEqual([
      { url: `${ORIGIN}${API_ROUTES.auth}/admin/stop-impersonating`, method: "POST" },
    ]);
  });

  it("checks role permissions locally through the admin plugin, so that the admin UI gates actions without a network call and a plain user cannot ban", async () => {
    const { authClient, sent } = await freshClient();
    expect(
      authClient.admin.checkRolePermission({ role: "admin", permissions: { user: ["ban"] } }),
    ).toBe(true);
    expect(
      authClient.admin.checkRolePermission({ role: "user", permissions: { user: ["ban"] } }),
    ).toBe(false);
    expect(sent).toEqual([]);
  });
});
