import type { AnalyticsDeliveryError } from "./analytics";
import type { BucketError } from "./bucket";
import type { RepositoryError } from "./repository";

export type AppError = RepositoryError | BucketError | AnalyticsDeliveryError;
