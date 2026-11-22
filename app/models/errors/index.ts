export * from "./repository";
export * from "./bucket";
export * from "./analytics";

import type { RepositoryError } from "./repository";
import type { BucketError } from "./bucket";
import type { AnalyticsDeliveryError } from "./analytics";

export type AppError = RepositoryError | BucketError | AnalyticsDeliveryError;
