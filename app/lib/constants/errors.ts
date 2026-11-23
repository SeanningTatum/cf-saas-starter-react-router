import type { AppError } from "@/models/errors/app-error";

export const APP_ERROR_TAGS: ReadonlySet<AppError["_tag"]> = new Set<AppError["_tag"]>([
  "NotFoundError",
  "CreationError",
  "UpdateError",
  "DeletionError",
  "QueryError",
  "ValidationError",
  "ConfigurationError",
  "ExternalServiceError",
  "BucketBindingError",
  "BucketUploadError",
  "BucketGetError",
  "BucketNotFoundError",
  "BucketDeleteError",
  "BucketListError",
  "BucketValidationError",
  "AnalyticsDeliveryError",
  "RateLimitError",
]);
