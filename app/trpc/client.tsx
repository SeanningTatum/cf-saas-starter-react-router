'use client';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { useState } from 'react';
import type { AppRouter } from './router';
import superjson from 'superjson';
import { makeQueryClient } from './query-client';
import { API_ROUTES } from "@/lib/constants/routes";

const api = createTRPCReact<AppRouter>();

let clientQueryClientSingleton: QueryClient;

function getQueryClient() {
  clientQueryClientSingleton ??= makeQueryClient();
  return clientQueryClientSingleton;
}

function getUrl() {
  const base = (() => {
    if (typeof window !== 'undefined') return '';
    return import.meta.env.VITE_AUTH_URL ?? 'http://localhost:5173';
  })();
  return `${base}${API_ROUTES.trpc}`;
}

export function TRPCProvider(
  props: Readonly<{
    children: React.ReactNode;
  }>,
) {
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