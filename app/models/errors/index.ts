export * from "./repository";
export * from "./bucket";
export * from "./analytics";
export * from "./rate-limit";

import type { RepositoryError } from "./repository";
import type { BucketError } from "./bucket";
import type { AnalyticsDeliveryError } from "./analytics";
import type { RateLimitError } from "./rate-limit";

export type AppError = RepositoryError | BucketError | AnalyticsDeliveryError | RateLimitError;
