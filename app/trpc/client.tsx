'use client';
// ^-- to make sure we can mount the Provider from a server component
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { useState } from 'react';
import type { AppRouter } from './router';
import superjson from 'superjson';
import { makeQueryClient } from './query-client';

export const api = createTRPCReact<AppRouter>();

let clientQueryClientSingleton: QueryClient;

function getQueryClient() {
  return (clientQueryClientSingleton ??= makeQueryClient());
}

function getUrl() {
  const base = (() => {
    if (typeof window !== 'undefined') return '';
    // TODO:- Get the correct URL from the environment variables
    // if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

    return 'http://localhost:5173';
  })();
  return `${base}/api/trpc`;
}

export function TRPCProvider(
  props: Readonly<{
    children: React.ReactNode;
  }>,
) {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        httpBatchLink({
          transformer: superjson,
          url: getUrl(),
        }),
      ],
    }),
  );
  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    </api.Provider>
  );
}