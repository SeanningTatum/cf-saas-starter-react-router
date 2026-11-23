import { Clock, Effect, Exit } from "effect";
import { data } from "react-router";
import { activeSession } from "@/auth/ban";
import { getSession } from "@/services/session";
import { UploadRepository } from "@/repositories/upload";
import {
  CONTENT_TYPE_HEADER,
  DOWNLOAD_HEADERS,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_METHOD_DELETE,
  HTTP_NOT_FOUND,
  HTTP_UNAUTHORIZED,
  UPLOAD_FAILED_MESSAGE,
  UPLOAD_NOT_FOUND_MESSAGE,
  UPLOAD_UNAUTHORIZED_MESSAGE,
} from "@/lib/constants/upload";
import type { Route } from "./+types/upload-object";

const refusal = (error: string, status: number) =>
  data({ success: false as const, error }, { status });

const notFound = () => Effect.succeed(refusal(UPLOAD_NOT_FOUND_MESSAGE, HTTP_NOT_FOUND));

const respond = (args: Route.LoaderArgs | Route.ActionArgs, serve: ServeFn) =>
  Effect.gen(function* () {
    const session = yield* getSession(args.context.auth.api, args.request.headers);
    const signedIn = activeSession(session, new Date(yield* Clock.currentTimeMillis));
    if (!signedIn) return refusal(UPLOAD_UNAUTHORIZED_MESSAGE, HTTP_UNAUTHORIZED);
    const uploads = yield* UploadRepository;
    return yield* serve(uploads, signedIn.user.id, args.params.id);
  }).pipe(
    Effect.catchTags({
      NotFoundError: notFound,
      BucketNotFoundError: notFound,
    }),
  );

type ServeFn = (
  uploads: UploadRepository,
  userId: string,
  id: string,
) => Effect.Effect<Response | ReturnType<typeof refusal> | { readonly success: true }, unknown>;

const run = async (args: Route.LoaderArgs | Route.ActionArgs, serve: ServeFn) => {
  const exit = await args.context.runtime.runPromiseExit(respond(args, serve));
  return Exit.match(exit, {
    onSuccess: (response) => response,
    onFailure: (cause) => {
      args.context.reportError({ error: cause, source: "upload" });
      return refusal(UPLOAD_FAILED_MESSAGE, HTTP_INTERNAL_SERVER_ERROR);
    },
  });
};

export async function loader(args: Route.LoaderArgs) {
  return run(args, (uploads, userId, id) =>
    uploads.readOwned(userId, id).pipe(
      Effect.map(
        ({ row, object }) =>
          new Response(object.body, {
            headers: {
              ...DOWNLOAD_HEADERS,
              [CONTENT_TYPE_HEADER]: row.contentType,
            },
          }),
      ),
    ),
  );
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== HTTP_METHOD_DELETE) {
    return refusal(UPLOAD_NOT_FOUND_MESSAGE, HTTP_NOT_FOUND);
  }
  return run(args, (uploads, userId, id) => uploads.removeOwned(userId, id));
}
