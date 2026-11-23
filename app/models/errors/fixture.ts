import { Data } from "effect";

export class FixtureValidationError extends Data.TaggedError("FixtureValidationError")<{
  readonly scenario: string;
  readonly fixture?: string;
  readonly message: string;
}> {}

export class SeedError extends Data.TaggedError("SeedError")<{
  readonly scenario: string;
  readonly target: "local" | "preview" | "remote" | "memory";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DevServerRunningError extends Data.TaggedError("DevServerRunningError")<{
  readonly pids: ReadonlyArray<number>;
  readonly stateDir: string;
}> {}

export class FixtureLoginError extends Data.TaggedError("FixtureLoginError")<{
  readonly role: "admin" | "user" | "banned";
  readonly status: number;
  readonly message: string;
}> {}

export class RealAnalyticsProviderError extends Data.TaggedError("RealAnalyticsProviderError")<{
  readonly file: string;
  readonly provider: string;
  readonly message: string;
}> {}

export type FixtureError =
  | FixtureValidationError
  | SeedError
  | DevServerRunningError
  | FixtureLoginError
  | RealAnalyticsProviderError;
