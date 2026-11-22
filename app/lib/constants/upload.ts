export const BYTES_PER_MEGABYTE = 1024 * 1024;
export const MAX_UPLOAD_SIZE_MEGABYTES = 10;
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MEGABYTES * BYTES_PER_MEGABYTE;

export const R2_MAX_KEY_LENGTH = 1024;

export const MULTIPART_ENVELOPE_ALLOWANCE_BYTES = 64 * 1024;
export const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_SIZE_BYTES + MULTIPART_ENVELOPE_ALLOWANCE_BYTES;
export const CONTENT_LENGTH_HEADER = "content-length";
export const DECIMAL_DIGITS = /^\d+$/;

export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_PAYLOAD_TOO_LARGE = 413;
export const HTTP_INTERNAL_SERVER_ERROR = 500;
export const HTTP_SERVICE_UNAVAILABLE = 503;

export const UPLOAD_UNAUTHORIZED_MESSAGE = "Unauthorized";
export const UPLOAD_NO_FILE_MESSAGE = "No file provided";
export const UPLOAD_NOT_A_FORM_MESSAGE = "The request body must be multipart form data";
export const UPLOAD_TOO_LARGE_MESSAGE = `The request is larger than the ${
  MAX_UPLOAD_SIZE_BYTES / BYTES_PER_MEGABYTE
}MB upload limit`;
export const UPLOAD_CONTENT_MISMATCH_MESSAGE = "File content does not match its declared type";
export const UPLOAD_UNAVAILABLE_MESSAGE = "Service temporarily unavailable";
export const UPLOAD_FAILED_MESSAGE = "Internal Server Error";
export const UPLOAD_FAILED_LOG = "Upload failed";

export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedUploadContentType =
  (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];

export const UPLOAD_TYPE_AND_SIZE_MESSAGE = `File must be one of [${ALLOWED_UPLOAD_CONTENT_TYPES.join(
  ", "
)}] and at most ${MAX_UPLOAD_SIZE_BYTES / BYTES_PER_MEGABYTE}MB`;

export const isAllowedUploadContentType = (
  value: string
): value is AllowedUploadContentType =>
  (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(value);

export const MAGIC_BYTES_SNIFF_LENGTH = 16;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF87A_AND_GIF89A_SIGNATURE_GIF8 = [0x47, 0x49, 0x46, 0x38];
const WEBP_RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_FORMAT_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const WEBP_FORMAT_SIGNATURE_OFFSET = 8;
const PDF_SIGNATURE_PERCENT_PDF = [0x25, 0x50, 0x44, 0x46];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

export const matchesMagicBytes = (
  type: AllowedUploadContentType,
  bytes: Uint8Array
): boolean => {
  switch (type) {
    case "image/png":
      return startsWith(bytes, PNG_SIGNATURE);
    case "image/jpeg":
      return startsWith(bytes, JPEG_SIGNATURE);
    case "image/gif":
      return startsWith(bytes, GIF87A_AND_GIF89A_SIGNATURE_GIF8);
    case "image/webp":
      return (
        startsWith(bytes, WEBP_RIFF_SIGNATURE) &&
        startsWith(bytes, WEBP_FORMAT_SIGNATURE, WEBP_FORMAT_SIGNATURE_OFFSET)
      );
    case "application/pdf":
      return startsWith(bytes, PDF_SIGNATURE_PERCENT_PDF);
  }
};

export const UPLOAD_FAILURE_TOO_BIG = { reason: "too_big" } as const;
export const UPLOAD_FAILURE_UNREACHABLE = { reason: "unreachable" } as const;

export const declaresOversizedUpload = (headers: Headers): boolean => {
  const declared = headers.get(CONTENT_LENGTH_HEADER)?.trim();
  return declared !== undefined && DECIMAL_DIGITS.test(declared) && Number(declared) > MAX_UPLOAD_REQUEST_BYTES;
};
