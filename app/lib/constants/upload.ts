/**
 * Shared upload limits — used by the `/api/upload-file` HTTP boundary route
 * and re-exportable by the UI (e.g. `FileUpload` `accept` / `maxSize` props)
 * so client-side and server-side validation never drift apart.
 */

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
] as const;

export type AllowedUploadContentType =
  (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];

export const isAllowedUploadContentType = (
  value: string
): value is AllowedUploadContentType =>
  (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(value);
