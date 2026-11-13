'use client';

import { useEffect, useRef, useState } from 'react';
import { autoRetryDelay, classifyLoadError, type LoadErrorKind } from '../lib/load-error';

interface AutoRetryOptions {
  error: unknown;
  /** A retry is in flight: no countdown until it settles. */
  retrying: boolean;
  /** Failed attempts in a row; each one doubles the wait. */
  failures: number;
  retry: () => void;
}

interface AutoRetryState {
  kind: LoadErrorKind;
  /** Seconds this countdown started from, or null when nothing is scheduled. */
  delay: number | null;
  secondsLeft: number | null;
}

/**
 * Retries a failed load on its own when the failure can clear up (offline,
 * API unreachable or unavailable): after a countdown that grows with each
 * failure, and at once when the browser comes back online.
 */
export function useAutoRetry({ error, retrying, failures, retry }: AutoRetryOptions): AutoRetryState {
  const kind = classifyLoadError(error);
  const delay = kind === 'failed' ? null : autoRetryDelay(failures);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(retrying ? null : delay);
  const latestRetry = useRef(retry);
  latestRetry.current = retry;

  useEffect(() => {
    if (delay === null || retrying) {
      setSecondsLeft(null);
      return;
    }
    let left = delay;
    setSecondsLeft(left);
    const timer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setSecondsLeft(left);
        return;
      }
      clearInterval(timer);
      setSecondsLeft(null);
      latestRetry.current();
    }, 1000);
    const onOnline = () => latestRetry.current();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
    // `error` restarts the countdown for each new failure, even one with the same delay.
  }, [error, delay, retrying]);

  return { kind, delay, secondsLeft };
}
