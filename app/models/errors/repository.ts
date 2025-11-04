/**
 * Base error class for repository operations
 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RepositoryError";
    Object.setPrototypeOf(this, RepositoryError.prototype);
  }
}

/**
 * Error thrown when a resource is not found
 */
export class NotFoundError extends RepositoryError {
  constructor(
    public readonly entity: string,
    public readonly identifier: string | Record<string, unknown>,
    message?: string
  ) {
    const defaultMessage =
      typeof identifier === "string"
        ? `${entity} not found: ${identifier}`
        : `${entity} not found`;
    super(message || defaultMessage, "NOT_FOUND", 404, {
      entity,
      identifier,
    });
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when resource creation fails
 */
export class CreationError extends RepositoryError {
  constructor(
    public readonly entity: string,
    message?: string,
    public readonly originalError?: unknown
  ) {
    super(message || `Failed to create ${entity}`, "CREATION_FAILED", 500, {
      entity,
      originalError,
    });
    this.name = "CreationError";
    Object.setPrototypeOf(this, CreationError.prototype);
  }
}

/**
 * Error thrown when resource update fails
 */
export class UpdateError extends RepositoryError {
  constructor(
    public readonly entity: string,
    message?: string,
    public readonly originalError?: unknown
  ) {
    super(message || `Failed to update ${entity}`, "UPDATE_FAILED", 500, {
      entity,
      originalError,
    });
    this.name = "UpdateError";
    Object.setPrototypeOf(this, UpdateError.prototype);
  }
}

/**
 * Error thrown when resource deletion fails
 */
export class DeletionError extends RepositoryError {
  constructor(
    public readonly entity: string,
    message?: string,
    public readonly originalError?: unknown
  ) {
    super(message || `Failed to delete ${entity}`, "DELETION_FAILED", 500, {
      entity,
      originalError,
    });
    this.name = "DeletionError";
    Object.setPrototypeOf(this, DeletionError.prototype);
  }
}

/**
 * Error thrown when resource query fails
 */
export class QueryError extends RepositoryError {
  constructor(
    public readonly entity: string,
    message?: string,
    public readonly originalError?: unknown
  ) {
    super(message || `Failed to query ${entity}`, "QUERY_FAILED", 500, {
      entity,
      originalError,
    });
    this.name = "QueryError";
    Object.setPrototypeOf(this, QueryError.prototype);
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends RepositoryError {
  constructor(
    public readonly entity: string,
    message: string,
    public readonly field?: string
  ) {
    super(message, "VALIDATION_FAILED", 400, { entity, field });
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error thrown when configuration is invalid or missing
 */
export class ConfigurationError extends RepositoryError {
  constructor(
    public readonly service: string,
    message?: string,
    public readonly field?: string
  ) {
    super(
      message || `Invalid or missing configuration for ${service}`,
      "CONFIGURATION_ERROR",
      500,
      { service, field }
    );
    this.name = "ConfigurationError";
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Error thrown when external service operation fails
 */
export class ExternalServiceError extends RepositoryError {
  constructor(
    public readonly service: string,
    message?: string,
    public readonly originalError?: unknown
  ) {
    super(
      message ||
        `External service operation failed: ${service}: ${originalError}`,
      "EXTERNAL_SERVICE_ERROR",
      500,
      { service, originalError: JSON.stringify(originalError) }
    );
    this.name = "ExternalServiceError";
    Object.setPrototypeOf(this, ExternalServiceError.prototype);
  }
}
