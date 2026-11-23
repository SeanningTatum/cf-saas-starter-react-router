export interface ReportBudgetOptions {
  readonly limit: number;
  readonly windowMs: number;
}

export interface ReportBudget {
  readonly take: (nowMs: number) => boolean;
}

export const makeReportBudget = ({ limit, windowMs }: ReportBudgetOptions): ReportBudget => {
  let windowStart = Number.NEGATIVE_INFINITY;
  let taken = 0;
  return {
    take: (nowMs) => {
      if (nowMs >= windowStart + windowMs) {
        windowStart = nowMs;
        taken = 0;
      }
      if (taken >= limit) return false;
      taken += 1;
      return true;
    },
  };
};
