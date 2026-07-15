/**
 * Shared upload limits — used by the `/api/upload-file` HTTP boundary route
 * and re-exportable by the UI (e.g. `FileUpload` `accept` / `maxSize` props)
 * so client-side and server-side validation never drift apart.
 *
 * `image/svg+xml` is deliberately NOT allowed: SVGs can embed scripts and
 * become a stored-XSS vector the moment uploaded files are served
 * same-origin. If you re-add it, serve uploads with
 * `Content-Disposition: attachment` or from a separate origin.
 */

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedUploadContentType =
  (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];

export const isAllowedUploadContentType = (
  value: string
): value is AllowedUploadContentType =>
  (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(value);

/** How many leading bytes `matchesMagicBytes` needs to make a decision. */
export const MAGIC_BYTES_SNIFF_LENGTH = 16;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

/**
 * Server-side content sniffing: the declared multipart `file.type` is
 * client-controlled and trivially spoofed, so the upload route also checks
 * the file's leading bytes against the signature of the declared type.
 */
export const matchesMagicBytes = (
  type: AllowedUploadContentType,
  bytes: Uint8Array
): boolean => {
  switch (type) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/gif":
      // "GIF8" (covers GIF87a and GIF89a)
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      // "RIFF" .... "WEBP"
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case "application/pdf":
      // "%PDF"
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
  }
};
