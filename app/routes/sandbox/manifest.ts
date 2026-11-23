import { Effect } from "effect";
import {
  SANDBOX_ALLOWED_METHODS,
  SANDBOX_BROKEN_BODY,
  SANDBOX_NOT_FOUND_BODY,
  SANDBOX_RESPONSE_HEADERS,
  SANDBOX_STATUS,
} from "@/lib/constants/sandbox";
import { SANDBOX_BUILD } from "@/lib/sandbox/build";
import { checkSandboxEnabled, type SandboxEnv } from "@/lib/sandbox/gate";
import { loadSandboxManifest } from "@/lib/sandbox/loader";

export interface SandboxManifestArgs {
  readonly context: { readonly cloudflare: { readonly env: SandboxEnv } };
}

const notFound = (): Response =>
  new Response(SANDBOX_NOT_FOUND_BODY, {
    status: SANDBOX_STATUS.notFound,
    headers: SANDBOX_RESPONSE_HEADERS,
  });

const isOpen = (env: SandboxEnv): Effect.Effect<boolean> =>
  checkSandboxEnabled(env, SANDBOX_BUILD).pipe(
    Effect.as(true),
    Effect.catchTag("SandboxDisabledError", () => Effect.succeed(false)),
  );

export async function loader({ context }: SandboxManifestArgs): Promise<Response> {
  const result = await Effect.runPromise(
    loadSandboxManifest({ env: context.cloudflare.env, built: SANDBOX_BUILD }),
  );
  if (result.status === SANDBOX_STATUS.notFound) return notFound();
  if (result.body === null) {
    return new Response(SANDBOX_BROKEN_BODY, {
      status: result.status,
      headers: SANDBOX_RESPONSE_HEADERS,
    });
  }
  return Response.json(result.body, { status: result.status, headers: SANDBOX_RESPONSE_HEADERS });
}

export async function action({ context }: SandboxManifestArgs): Promise<Response> {
  if (!(await Effect.runPromise(isOpen(context.cloudflare.env)))) return notFound();
  return new Response(null, {
    status: SANDBOX_STATUS.wrongMethod,
    headers: { ...SANDBOX_RESPONSE_HEADERS, allow: SANDBOX_ALLOWED_METHODS },
  });
}
