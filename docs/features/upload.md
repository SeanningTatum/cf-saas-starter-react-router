# File upload

One signed-in user uploads one file to R2 through `POST /api/upload-file` (`app/routes/api/upload-file.ts`). The browser side is the `FileUpload` drop zone (`app/components/file-upload.tsx`), whose behaviour is the XState machine in `app/components/file-upload.machine.ts`, and `uploadFile` in `app/lib/upload-client.ts`. Limits and allowed types live in `app/lib/constants/upload.ts`. Rate limits: [docs/auth.md](../auth.md#rate-limits).

## Why

- **R2 may be off.** `wrangler.jsonc` has no `r2_buckets` when setup ran with R2 disabled, and then the generated `Env` has no `BUCKET`. `BucketLive` reads it as optional (`EnvWhereR2MayBeOff`) and fails with `BucketBindingError` when it is missing, so the code type-checks with R2 on or off.
