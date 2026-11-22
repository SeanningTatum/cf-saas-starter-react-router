# tRPC client

`app/trpc/client.tsx` sets up the browser's tRPC client and its React Query client.

## Why

- **An absolute URL on the server.** Queries hydrate in the browser, so the server render never sends a tRPC request, but `httpBatchLink` still needs an absolute URL to be built. On the server the base is `VITE_AUTH_URL`, fixed at build time, else `http://localhost:5173` for `bun run dev`; in the browser it is the page's own origin.
- **One query client per browser tab.** `getQueryClient` keeps a module-level client instead of `useState`: with no suspense boundary above the provider, React throws away state made during a render that suspends, and the client with it.
- **The file starts with `'use client'`** so the provider can be mounted from a server component.
