import { HEALTH_DOWN, HEALTH_UP } from "@/lib/constants/health";

export interface HealthReport {
  readonly status: typeof HEALTH_UP | typeof HEALTH_DOWN;
  readonly release: string;
}

export interface SharedCheck {
  readonly get: (nowMs: number, check: () => Promise<boolean>) => Promise<boolean>;
}

export const makeSharedCheck = (ttlMs: number): SharedCheck => {
  let startedAt = Number.NEGATIVE_INFINITY;
  let running = false;
  let last: Promise<boolean> = Promise.resolve(false);
  return {
    get: (nowMs, check) => {
      if (running || (nowMs >= startedAt && nowMs < startedAt + ttlMs)) return last;
      startedAt = nowMs;
      running = true;
      last = check()
        .then(
          (up) => up,
          () => false,
        )
        .finally(() => {
          running = false;
        });
      return last;
    },
  };
};

export const healthReport = (up: boolean, release: string): HealthReport => ({
  status: up ? HEALTH_UP : HEALTH_DOWN,
  release,
});
