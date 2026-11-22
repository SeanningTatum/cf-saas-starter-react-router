export interface SamplingRates {
  readonly logs: number;
  readonly traces: number;
}

export const KEEP_ALL: SamplingRates = { logs: 1, traces: 1 };

export const PRODUCTION_SAMPLING: SamplingRates = { logs: 1, traces: 0.1 };

export const SAMPLING_BY_ENVIRONMENT: Readonly<Record<string, SamplingRates>> = {
  development: KEEP_ALL,
  preview: KEEP_ALL,
  staging: KEEP_ALL,
  production: PRODUCTION_SAMPLING,
};
