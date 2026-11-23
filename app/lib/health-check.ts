import { HEALTH_DOWN, HEALTH_UP } from "@/lib/constants/health";

export interface HealthReport {
  readonly status: typeof HEALTH_UP | typeof HEALTH_DOWN;
  readonly release: string;
}

export interface HealthMemo {
  readonly read: (nowMs: number) => boolean | undefined;
  readonly write: (nowMs: number, up: boolean) => void;
}

export const makeHealthMemo = (ttlMs: number): HealthMemo => {
  let checkedAt = Number.NEGATIVE_INFINITY;
  let last = false;
  return {
    read: (nowMs) => (nowMs >= checkedAt && nowMs < checkedAt + ttlMs ? last : undefined),
    write: (nowMs, up) => {
      checkedAt = nowMs;
      last = up;
    },
  };
};

export const healthReport = (up: boolean, release: string): HealthReport => ({
  status: up ? HEALTH_UP : HEALTH_DOWN,
  release,
});
