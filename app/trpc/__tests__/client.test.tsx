import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_ROUTES } from "@/lib/constants/routes";

const links = vi.hoisted(() => ({ urls: [] as unknown[] }));

vi.mock("@trpc/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@trpc/client")>();
  return {
    ...real,
    httpBatchLink: (options: Parameters<typeof real.httpBatchLink>[0]) => {
      links.urls.push(options.url);
      return real.httpBatchLink(options);
    },
  };
});

const seen: QueryClient[] = [];

const Probe = () => {
  const client = useQueryClient();
  seen.push(client);
  return <span>{String(client.getDefaultOptions().queries?.staleTime)}</span>;
};

const freshProvider = async () => {
  links.urls.length = 0;
  seen.length = 0;
  vi.resetModules();
  const { TRPCProvider } = await import("../client");
  const render = () =>
    renderToString(
      <TRPCProvider>
        <Probe />
      </TRPCProvider>,
    );
  return { render, seen };
};

describe("TRPCProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("supplies the QueryClient from makeQueryClient and reuses it across renders, so that a provider that builds a bare client or a new one per render loses the 30 second staleTime and the cache", async () => {
    const { makeQueryClient } = await import("../query-client");
    const { render, seen } = await freshProvider();
    const expected = String(makeQueryClient().getDefaultOptions().queries?.staleTime);
    expect(render()).toBe(`<span>${expected}</span>`);
    render();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("points the batch link at localhost:5173 plus API_ROUTES.trpc when there is no window and no VITE_AUTH_URL, so that SSR in dev reaches the local tRPC handler", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubEnv("VITE_AUTH_URL", undefined);
    const { render } = await freshProvider();
    render();
    expect(links.urls).toEqual([`http://localhost:5173${API_ROUTES.trpc}`]);
  });

  it("lets VITE_AUTH_URL set the server-side origin, so that SSR in a deployed Worker does not call localhost", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubEnv("VITE_AUTH_URL", "https://app.example.com");
    const { render } = await freshProvider();
    render();
    expect(links.urls).toEqual([`https://app.example.com${API_ROUTES.trpc}`]);
  });

  it("uses the bare API_ROUTES.trpc path in the browser, so that the client calls its own origin and never a hard-coded host", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("VITE_AUTH_URL", "https://app.example.com");
    const { render } = await freshProvider();
    render();
    expect(links.urls).toEqual([API_ROUTES.trpc]);
  });
});
