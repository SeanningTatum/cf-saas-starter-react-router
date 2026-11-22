# File upload

One signed-in user uploads one file to R2 through `POST /api/upload-file` (`app/routes/api/upload-file.ts`). The browser side is the `FileUpload` drop zone (`app/components/file-upload.tsx`), whose behaviour is the XState machine in `app/components/file-upload.machine.ts`, and `uploadFile` in `app/lib/upload-client.ts`. Limits and allowed types live in `app/lib/constants/upload.ts`. Rate limits: [docs/auth.md](../auth.md#rate-limits).

## Why

- **One set of limits for both sides.** The route and the browser read the same constants: `FileUpload`'s default `maxSize` is `MAX_UPLOAD_SIZE_BYTES`, and a caller builds `accept` from `ALLOWED_UPLOAD_CONTENT_TYPES`, as the kitchen sink does. The browser's check and the server's cannot drift apart.
- **No SVG.** `image/svg+xml` is not allowed: an SVG can carry script and becomes a stored-XSS vector once uploads are served from the app's origin. To allow it, serve uploads with `Content-Disposition: attachment` or from another origin first ([security-headers.md](../security-headers.md#before-you-change-the-defaults)). Test: "rejects image/svg+xml" (`app/lib/constants/__tests__/upload.test.ts`).
- **The server sniffs the content.** The multipart `file.type` is chosen by the client, so the route also checks the file's first bytes against the signature of the declared type (`matchesMagicBytes`). Test: "rejects a spoofed declared type" (same file).
- **What the browser shows.** `uploadFile` turns the route's own refusal (wrong type, too big, signed out) into a `BucketValidationError` carrying the route's message, which is written to be shown. Anything that stops a readable reply (offline, aborted, a body that is not the route's JSON) becomes an `ExternalServiceError`, and the drop zone shows its own text. Tests: `app/lib/__tests__/upload-client.test.ts`.
- **Keys are capped at R2's limit**, `R2_MAX_KEY_LENGTH` (1024).

- **R2 may be off.** `wrangler.jsonc` has no `r2_buckets` when setup ran with R2 disabled, and then the generated `Env` has no `BUCKET`. `BucketLive` reads it as optional (`EnvWhereR2MayBeOff`) and fails with `BucketBindingError` when it is missing, so the code type-checks with R2 on or off.
