import type { Effect } from "effect";
import type {
  ERROR_KINDS,
  ERROR_LEVELS,
  ERROR_SOURCES,
} from "@/lib/constants/error-reporting";
import type { ExternalServiceError } from "@/models/errors/repository";

export type ErrorSource = (typeof ERROR_SOURCES)[number];
export type ErrorKind = (typeof ERROR_KINDS)[number];
export type ErrorLevel = (typeof ERROR_LEVELS)[number];

export interface ErrorReport {
  readonly id: string;
  readonly timestamp: string;
  readonly source: ErrorSource;
  readonly kind: ErrorKind;
  readonly level: ErrorLevel;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly tag?: string;
  readonly requestId?: string;
  readonly userId?: string;
  readonly release: string;
  readonly environment: string;
  readonly method?: string;
  readonly path?: string;
  readonly url?: string;
}

export interface ErrorReporterAdapter {
  readonly name: string;
  readonly send: (
    batch: ReadonlyArray<ErrorReport>
  ) => Effect.Effect<void, ExternalServiceError>;
}
