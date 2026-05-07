# Feature: File Upload

_Last updated: 2026-05-07_

## Purpose
Server-side file upload to Cloudflare R2. Exposed as a multipart/form-data endpoint. Backed by `BucketRepository` over the `BUCKET` binding.

## When It's Used
- Any UI component that accepts a file → posts to `/api/upload-file`
- Today only `<FileUpload>` consumes it; no production UI calls it on a hot path

## How It Works

`POST /api/upload-file` (action handler):

1. Pulls `file` field from `FormData`. Returns 400 if missing or not a `File`.
2. Resolves an Effect program against `context.runtime`:
   ```typescript
   const exit = await context.runtime.runPromiseExit(
     Effect.gen(function* () {
       const repo = yield* BucketRepository;
       return yield* repo.upload(file);
     }).pipe(Effect.tapErrorCause((cause) => Effect.logError("Upload failed", cause)))
   );
   ```
3. Outcomes:
   - `200 { success: true, key: "uploads/<timestamp>-<uuid>" }` on success
   - `400 "No file provided"` if the form field is missing or not a `File`
   - `500 <Cause.pretty(...)>` if the Effect program fails (R2 binding, upload error, etc.)

`BucketRepository.upload` accepts `File | Blob | Uint8Array | string` plus `{ key?, contentType? }`. Default key generator: `uploads/${Date.now()}-${crypto.randomUUID()}`. Wraps `bucket.put` in `Effect.tryPromise`, mapping failure → `BucketUploadError`.

### Persistence details
- Storage: R2 (`BUCKET` binding, `bucket_name: "testing-bucket"` in `wrangler.jsonc`)
- Object key: `uploads/<timestamp>-<uuid>` unless caller overrides via `options.key`
- Content type: from `File.type` if `File`; otherwise from `options.contentType`
- No metadata stored beyond `httpMetadata.contentType`

### Testability
- `app/repositories/__tests__/bucket.test.ts` — repo unit tests (stubbed `Bucket` service)
- `app/lib/__tests__/effect-trpc.test.ts` covers `BucketUploadError`, `BucketGetError`, `BucketDeleteError`, `BucketListError`, `BucketBindingError`, `BucketNotFoundError`, `BucketValidationError` mapping
- No e2e

## Key Files

| File | Role |
|------|------|
| [`app/components/file-upload.tsx`](../../app/components/file-upload.tsx) | UI component |
| [`app/routes/api/upload-file.ts`](../../app/routes/api/upload-file.ts) | `POST /api/upload-file` action handler |
| [`app/repositories/bucket.ts`](../../app/repositories/bucket.ts) | `BucketRepository` (`upload`, `get`, `remove`, `list`) |
| [`app/services/bucket.ts`](../../app/services/bucket.ts) | `Bucket` Effect Tag + `BucketLive` |
| [`app/lib/schemas/bucket.ts`](../../app/lib/schemas/bucket.ts) | `UploadOptions`, `ListR2Input` |
| [`app/models/errors/bucket.ts`](../../app/models/errors/bucket.ts) | All bucket-tagged errors |

## Dependencies

- CF binding: `BUCKET` (R2)
- Effect services: `Bucket`
- Repositories: `BucketRepository`

## Tagged Errors

| Error | Where raised | tRPC code |
|-------|--------------|-----------|
| `BucketBindingError` | `BucketLive` if `env.BUCKET` is undefined | `INTERNAL_SERVER_ERROR` |
| `BucketUploadError` | `BucketRepository.upload` | `INTERNAL_SERVER_ERROR` |
| `BucketGetError` | `BucketRepository.get` | `INTERNAL_SERVER_ERROR` |
| `BucketDeleteError` | `BucketRepository.remove` | `INTERNAL_SERVER_ERROR` |
| `BucketListError` | `BucketRepository.list` | `INTERNAL_SERVER_ERROR` |
| `BucketNotFoundError` | wired in `tagToTRPC`, **not raised by any repo method today** — wrap `get` with `requireFound` to use it | `NOT_FOUND` |
| `BucketValidationError` | wired but not raised — reserved for size / mime-type validation | `BAD_REQUEST` |

## Known gaps

See [`../high-level-architecture/security.md`](../high-level-architecture/security.md) gaps #2–#4:

1. Route is unauthenticated — anyone with the URL can write to R2.
2. `upload` does not validate file type or size.
3. Response returns the R2 key only — no public URL or signed URL is constructed. Consumers must know the bucket's public hostname.

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-05-07 | brain | First per-feature memory; documented real return shape (`key`, not `url`) and security gaps |
