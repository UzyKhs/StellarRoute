'use client';

/**
 * Quote fetching with manual refresh (cooldown), optional auto-refresh, and stale detection.
 * Enhanced with:
 * - Exponential backoff with jitter to prevent thundering herd
 * - Configurable backoff limits and max delays
 * - Retry cancellation support
 * - Telemetry/metrics for monitoring retry attempts
 * 
 * Uses `stellarRouteClient.getQuote` as the only HTTP path for quotes (same as `useQuote`).
 *
 * Extension point — real-time updates: when the API exposes WebSocket (or SSE) quote streams,
 * subscribe here alongside or instead of the auto-refresh interval; update `data` and reset
 * `lastQuotedAtMs` from pushed payloads while keeping manual refresh as a fallback.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  StellarRouteApiError,
  stellarRouteClient,
} from '@/lib/api/client';
import {
  isQuoteStale,
  QUOTE_AMOUNT_DEBOUNCE_MS,
  QUOTE_AUTO_REFRESH_INTERVAL_MS,
  QUOTE_MANUAL_REFRESH_COOLDOWN_MS,
  QUOTE_STALE_AFTER_MS,
} from '@/lib/quote-stale';
import type { PriceQuote, QuoteType } from '@/types';
import type { UseApiState } from '@/hooks/useApi';

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export interface UseQuoteRefreshOptions {
  staleAfterMs?: number;
  autoRefreshIntervalMs?: number;
  manualRefreshCooldownMs?: number;
  debounceMs?: number;
  /** Optional connectivity override. When false, network quote requests are paused. */
  isOnline?: boolean;
  /** Auto-retry attempts for transient online quote failures. */
  maxAutoRetries?: number;
  /** Base delay in ms for retry backoff: attempt * retryBackoffMs. */
  retryBackoffMs?: number;
  /** Maximum backoff delay in ms; prevents backoff from growing unbounded (default: 30000) */
  retryBackoffMaxMs?: number;
  /** Jitter factor (0 to 1); randomizes backoff to prevent thundering herd (default: 0.1) */
  retryJitterFactor?: number;
}

export interface RetryMetrics {
  /** Total number of quote request attempts */
  totalAttempts: number;
  /** Total number of retry attempts */
  totalRetries: number;
  /** Timestamp of the last retry attempt (ms), or null if never retried */
  lastRetryTimestampMs: number | null;
}

export type UseQuoteRefreshState = UseApiState<PriceQuote> & {
  /** Manual refresh; blocked during cooldown or while inputs are invalid. */
  refresh: () => void;
  /** True after a manual refresh until the cooldown elapses. */
  manualRefreshCoolingDown: boolean;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: (enabled: boolean) => void;
  /** True when we have a quote and it is older than the stale TTL. */
  isStale: boolean;
  /** Wall-clock time of the last successful quote fetch, or null. */
  lastQuotedAtMs: number | null;
  /** True while transient online quote failures are being retried. */
  isRecovering: boolean;
  /** Current transient retry attempt count for the active request context. */
  retryAttempt: number;
  /** Remaining wait time from Retry-After, if the API is currently rate-limiting requests. */
  rateLimitRemainingMs: number;
  /** Cancel pending retry attempt if one is in progress. */
  cancelRetry: () => void;
  /** Metrics about retry attempts */
  retryMetrics: RetryMetrics;
};

function isTransientQuoteError(err: Error): boolean {
  if (err instanceof StellarRouteApiError) {
    return err.status === 0 || err.status === 429 || err.status >= 500;
  }

  const message = err.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('failed to fetch')
  );
}

/**
 * Calculate exponential backoff delay with jitter and upper bound.
 */
function calculateBackoffWithJitter(
  attemptNumber: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number,
): number {
  // Exponential growth: attempt * base delay
  const exponentialDelay = Math.min(
    attemptNumber * baseDelayMs,
    maxDelayMs,
  );
  
  // Add jitter to randomize and prevent thundering herd
  const jitterAmount = exponentialDelay * jitterFactor;
  const jitter = Math.random() * jitterAmount;
  
  return Math.ceil(exponentialDelay + jitter);
}

export function useQuoteRefresh(
  base: string,
  quoteAsset: string,
  amount: number | undefined,
  type: QuoteType = 'sell',
  options?: UseQuoteRefreshOptions,
): UseQuoteRefreshState {
  const staleAfterMs = options?.staleAfterMs ?? QUOTE_STALE_AFTER_MS;
  const autoRefreshIntervalMs =
    options?.autoRefreshIntervalMs ?? QUOTE_AUTO_REFRESH_INTERVAL_MS;
  const manualRefreshCooldownMs =
    options?.manualRefreshCooldownMs ?? QUOTE_MANUAL_REFRESH_COOLDOWN_MS;
  const debounceMs = options?.debounceMs ?? QUOTE_AMOUNT_DEBOUNCE_MS;
  const isOnline = options?.isOnline ?? true;
  const maxAutoRetries = options?.maxAutoRetries ?? 2;
  const retryBackoffMs = options?.retryBackoffMs ?? 1_000;
  const retryBackoffMaxMs = options?.retryBackoffMaxMs ?? 30_000;
  const retryJitterFactor = Math.min(1, Math.max(0, options?.retryJitterFactor ?? 0.1));

  const debouncedAmount = useDebounced(amount, debounceMs);
  const [tick, setTick] = useState(0);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [state, setState] = useState<UseApiState<PriceQuote>>({
    data: undefined,
    loading: false,
    error: null,
  });
  const [manualCooldownUntil, setManualCooldownUntil] = useState(0);
  const [lastQuotedAtMs, setLastQuotedAtMs] = useState<number | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [rateLimitUntilMs, setRateLimitUntilMs] = useState(0);
  const [cancelRetryFlag, setCancelRetryFlag] = useState(false);
  const [retryMetrics, setRetryMetrics] = useState<RetryMetrics>({
    totalAttempts: 0,
    totalRetries: 0,
    lastRetryTimestampMs: null,
  });
  const [retryTimerRef, setRetryTimerRef] = useState<ReturnType<typeof setTimeout> | null>(null);

  const hasValidInputs =
    Boolean(base) &&
    Boolean(quoteAsset) &&
    debouncedAmount !== undefined &&
    Number.isFinite(debouncedAmount) &&
    debouncedAmount > 0;
  const canRequest = hasValidInputs && isOnline;

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional retry-state reset when request inputs change
    setRetryAttempt(0);
    setIsRecovering(false);
    setRateLimitUntilMs(0);
    setCancelRetryFlag(false);
    if (retryTimerRef) {
      clearTimeout(retryTimerRef);
      setRetryTimerRef(null);
    }
  }, [base, quoteAsset, debouncedAmount, type]);

  useEffect(() => {
    if (!canRequest) return;

    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    
    // Same pattern as `useFetch` in useApi.ts: set loading before starting the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading transition before async getQuote
    setState((prev) => ({ ...prev, loading: true, error: null }));

    setRetryMetrics((prev) => ({
      ...prev,
      totalAttempts: prev.totalAttempts + 1,
    }));

    stellarRouteClient
      .getQuote(base, quoteAsset, debouncedAmount, type, {
        signal: controller.signal,
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          const t = Date.now();
          setLastQuotedAtMs(t);
          setRetryAttempt(0);
          setIsRecovering(false);
          setRateLimitUntilMs(0);
          setCancelRetryFlag(false);
          setState({ data, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          const normalizedError =
            err instanceof StellarRouteApiError || err instanceof Error
              ? err
              : new Error(String(err));
          const shouldRetry =
            isOnline &&
            isTransientQuoteError(normalizedError) &&
            retryAttempt < maxAutoRetries &&
            !cancelRetryFlag;
          const rateLimitDelayMs =
            normalizedError instanceof StellarRouteApiError &&
            normalizedError.isRateLimit
              ? normalizedError.retryAfterMs
              : null;

          setRateLimitUntilMs(
            rateLimitDelayMs ? Date.now() + rateLimitDelayMs : 0,
          );

          setState((prev) => ({
            // Preserve last successful quote so users can still act on stale-but-visible data.
            data: prev.data,
            loading: false,
            error: normalizedError,
          }));

          if (shouldRetry) {
            const nextAttempt = retryAttempt + 1;
            setRetryAttempt(nextAttempt);
            setIsRecovering(true);
            
            // Record retry metric
            setRetryMetrics((prev) => ({
              totalAttempts: prev.totalAttempts,
              totalRetries: prev.totalRetries + 1,
              lastRetryTimestampMs: Date.now(),
            }));
            
            // Calculate backoff with jitter
            const backoffMs = rateLimitDelayMs ?? calculateBackoffWithJitter(
              nextAttempt,
              retryBackoffMs,
              retryBackoffMaxMs,
              retryJitterFactor,
            );
            
            retryTimer = setTimeout(() => {
              if (!cancelRetryFlag) {
                setTick((n) => n + 1);
              }
            }, backoffMs);
            setRetryTimerRef(retryTimer);
            return;
          }

          setIsRecovering(false);
        }
      });

    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    base,
    quoteAsset,
    debouncedAmount,
    type,
    tick,
    canRequest,
    isOnline,
    maxAutoRetries,
    retryAttempt,
    retryBackoffMs,
    retryBackoffMaxMs,
    retryJitterFactor,
    cancelRetryFlag,
  ]);

  useEffect(() => {
    if (manualCooldownUntil === 0) return;
    const remaining = manualCooldownUntil - Date.now();
    const id = setTimeout(
      () => setManualCooldownUntil(0),
      Math.max(0, remaining),
    );
    return () => clearTimeout(id);
  }, [manualCooldownUntil]);

  const refresh = useCallback(() => {
    if (!canRequest) return;
    const t = Date.now();
    if (t < manualCooldownUntil || t < rateLimitUntilMs) return;
    setManualCooldownUntil(t + manualRefreshCooldownMs);
    setRateLimitUntilMs(0);
    setTick((n) => n + 1);
  }, [
    canRequest,
    manualCooldownUntil,
    manualRefreshCooldownMs,
    rateLimitUntilMs,
  ]);

  const cancelRetry = useCallback(() => {
    setCancelRetryFlag(true);
    if (retryTimerRef) {
      clearTimeout(retryTimerRef);
      setRetryTimerRef(null);
    }
  }, [retryTimerRef]);

  useEffect(() => {
    if (!autoRefreshEnabled || !canRequest) return;

    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      setTick((n) => n + 1);
    }, autoRefreshIntervalMs);

    return () => clearInterval(id);
  }, [autoRefreshEnabled, autoRefreshIntervalMs, canRequest]);

  const manualRefreshCoolingDown =
    manualCooldownUntil > 0 && nowMs < manualCooldownUntil;

  const data = hasValidInputs ? state.data : undefined;
  const loading = canRequest && state.loading;
  const error = !hasValidInputs
    ? null
    : !isOnline
      ? new Error('You are offline. Reconnect to refresh quotes.')
      : state.error;

  const isStale =
    data !== undefined && isQuoteStale(lastQuotedAtMs, nowMs, staleAfterMs);
  const rateLimitRemainingMs =
    rateLimitUntilMs > nowMs ? rateLimitUntilMs - nowMs : 0;

  return {
    data,
    loading,
    error,
    refresh,
    manualRefreshCoolingDown,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    isStale,
    lastQuotedAtMs,
    isRecovering,
    retryAttempt,
    rateLimitRemainingMs,
    cancelRetry,
    retryMetrics,
  };
}
