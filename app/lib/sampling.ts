import {
  PRODUCTION_SAMPLING,
  SAMPLING_BY_ENVIRONMENT,
  type SamplingRates,
} from "@/lib/constants/sampling";

export interface SamplingDecision {
  readonly logs: boolean;
  readonly traces: boolean;
}

const rateFrom = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : fallback;
};

export const readSampling = (
  env: { readonly LOG_SAMPLE_RATE?: string; readonly TRACE_SAMPLE_RATE?: string },
  environment: string
): SamplingRates => {
  const preset = SAMPLING_BY_ENVIRONMENT[environment] ?? PRODUCTION_SAMPLING;
  return {
    logs: rateFrom(env.LOG_SAMPLE_RATE, preset.logs),
    traces: rateFrom(env.TRACE_SAMPLE_RATE, preset.traces),
  };
};

export const decideSampling = (
  rates: SamplingRates,
  random: () => number = Math.random
): SamplingDecision => ({
  logs: random() < rates.logs,
  traces: random() < rates.traces,
});
