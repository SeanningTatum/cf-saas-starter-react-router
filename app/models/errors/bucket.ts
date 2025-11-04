/**
 * Base error class for R2 bucket operations
 */
export class BucketError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "BucketError";
    Object.setPrototypeOf(this, BucketError.prototype);
  }
}

/**
 * Error thrown when the BUCKET binding is not found in Cloudflare environment
 */
export class BucketBindingError extends BucketError {
  constructor(
    message: string = "BUCKET binding not found in Cloudflare environment"
  ) {
    super(message, "BUCKET_BINDING_NOT_FOUND", 500);
    this.name = "BucketBindingError";
    Object.setPrototypeOf(this, BucketBindingError.prototype);
  }
}

/**
 * Error thrown when upload operation fails
 */
export class BucketUploadError extends BucketError {
  constructor(
    message: string = "Failed to upload file to R2",
    public readonly originalError?: unknown
  ) {
    super(message, "BUCKET_UPLOAD_FAILED", 500);
    this.name = "BucketUploadError";
    Object.setPrototypeOf(this, BucketUploadError.prototype);
  }
}

/**
 * Error thrown when get operation fails
 */
export class BucketGetError extends BucketError {
  constructor(
    message: string = "Failed to get file from R2",
    public readonly originalError?: unknown
  ) {
    super(message, "BUCKET_GET_FAILED", 500);
    this.name = "BucketGetError";
    Object.setPrototypeOf(this, BucketGetError.prototype);
  }
}

/**
 * Error thrown when file is not found in R2
 */
export class BucketNotFoundError extends BucketError {
  constructor(
    public readonly key: string,
    message: string = `File not found: ${key}`
  ) {
    super(message, "BUCKET_FILE_NOT_FOUND", 404);
    this.name = "BucketNotFoundError";
    Object.setPrototypeOf(this, BucketNotFoundError.prototype);
  }
}

/**
 * Error thrown when delete operation fails
 */
export class BucketDeleteError extends BucketError {
  constructor(
    message: string = "Failed to delete file from R2",
    public readonly originalError?: unknown
  ) {
    super(message, "BUCKET_DELETE_FAILED", 500);
    this.name = "BucketDeleteError";
    Object.setPrototypeOf(this, BucketDeleteError.prototype);
  }
}

/**
 * Error thrown when list operation fails
 */
export class BucketListError extends BucketError {
  constructor(
    message: string = "Failed to list R2 objects",
    public readonly originalError?: unknown
  ) {
    super(message, "BUCKET_LIST_FAILED", 500);
    this.name = "BucketListError";
    Object.setPrototypeOf(this, BucketListError.prototype);
  }
}

/**
 * Error thrown when file validation fails
 */
export class BucketValidationError extends BucketError {
  constructor(message: string, public readonly field?: string) {
    super(message, "BUCKET_VALIDATION_FAILED", 400);
    this.name = "BucketValidationError";
    Object.setPrototypeOf(this, BucketValidationError.prototype);
  }
}
