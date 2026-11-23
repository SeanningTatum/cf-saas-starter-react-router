import { useCallback, useEffect, useState } from "react";
import { retryWaitSeconds, type RefusedResponse } from "@/lib/auth-errors";
import { MS_PER_SECOND } from "@/lib/constants/rate-limit";

export interface RetryCooldown {
  readonly secondsLeft: number;
  readonly waiting: boolean;
  readonly startFrom: (response: RefusedResponse) => void;
}

export function useRetryCooldown(): RetryCooldown {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return;
    const timer = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= until) setUntil(null);
    }, MS_PER_SECOND);
    return () => window.clearInterval(timer);
  }, [until]);

  const startFrom = useCallback((response: RefusedResponse) => {
    const started = Date.now();
    const seconds = retryWaitSeconds(response, started);
    if (seconds === null) return;
    setNow(started);
    setUntil(started + seconds * MS_PER_SECOND);
  }, []);

  const secondsLeft = until === null ? 0 : Math.max(0, Math.ceil((until - now) / MS_PER_SECOND));
  return { secondsLeft, waiting: secondsLeft > 0, startFrom };
}
