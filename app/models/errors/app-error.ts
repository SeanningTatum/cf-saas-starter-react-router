import type { AnalyticsDeliveryError } from "./analytics";
import type { BucketError } from "./bucket";
import type { FixtureError } from "./fixture";
import type { RateLimitError } from "./rate-limit";
import type { RepositoryError } from "./repository";
import type { SandboxError } from "./sandbox";

export type AppError =
  | RepositoryError
  | BucketError
  | AnalyticsDeliveryError
  | RateLimitError
  | FixtureError
  | SandboxError;
