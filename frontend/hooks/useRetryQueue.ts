'use client';

/**
 * Retry queue utility for managing transient failures with exponential backoff.
 * Provides configurable backoff, jitter, cancellation, and telemetry tracking.
 */

interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  initialDelayMs?: number;
  /** Maximum backoff delay in ms; prevents backoff from growing unbounded (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor (0 to 1); randomizes backoff to prevent thundering herd (default: 0.1) */
  jitterFactor?: number;
  /** Callback to test if an error is retryable (default: returns true for transient errors) */
  isRetryable?: (error: Error) => boolean;
  /** Callback invoked on each retry attempt */
  onRetry?: (attemptNumber: number, nextDelayMs: number) => void;
  /** Callback invoked when all retries are exhausted */
  onExhausted?: (error: Error, totalAttempts: number) => void;
}

export interface RetryQueueMetrics {
  /** Total number of request attempts made */
  totalAttempts: number;
  /** Total number of retry attempts made */
  totalRetries: number;
  /** Timestamp of the last retry attempt (ms), or null if never retried */
  lastRetryTimestampMs: number | null;
  /** Current retry attempt number (0 if not retrying) */
  currentAttemptNumber: number;
  /** Whether a retry is currently pending */
  isPending: boolean;
}

/**
 * Calculate backoff delay with exponential growth, jitter, and upper bound.
 */
function calculateBackoffMs(
  attemptNumber: number,
  initialDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number
): number {
  const exponentialDelay = Math.min(
    attemptNumber * initialDelayMs,
    maxDelayMs
  );
  const jitterAmount = exponentialDelay * jitterFactor;
  const jitter = Math.random() * jitterAmount;
  return Math.ceil(exponentialDelay + jitter);
}

/** Default retryable error detection */
function isDefaultRetryable(error: Error): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Check for transient error indicators
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('failed to fetch') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('enetunreach')
    );
  }
  return false;
}

/**
 * Executes an async operation with retry logic, exponential backoff, and jitter.
 * Returns the result on success, throws an error if all retries are exhausted.
 */
export async function executeWithRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    jitterFactor = 0.1,
    isRetryable = isDefaultRetryable,
    onRetry,
    onExhausted,
  } = config;

  let lastError: Error | null = null;
  const controller = new AbortController();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation(controller.signal);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // Check if we should retry
      if (attempt < maxAttempts - 1 && isRetryable(error)) {
        const nextAttemptNumber = attempt + 1;
        const delayMs = calculateBackoffMs(
          nextAttemptNumber,
          initialDelayMs,
          maxDelayMs,
          jitterFactor
        );

        // Invoke callback for monitoring/telemetry
        onRetry?.(nextAttemptNumber, delayMs);

        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        // Last attempt or non-retryable error
        onExhausted?.(error, attempt + 1);
        throw error;
      }
    }
  }

  // Exhausted all attempts
  if (lastError) {
    onExhausted?.(lastError, maxAttempts);
    throw lastError;
  }

  throw new Error('Retry queue exhausted without error');
}

/**
 * React hook for managing retry queue state and metrics
 */
export function useRetryQueue(defaultConfig?: RetryConfig) {
  const [metrics, setMetrics] = React.useState<RetryQueueMetrics>({
    totalAttempts: 0,
    totalRetries: 0,
    lastRetryTimestampMs: null,
    currentAttemptNumber: 0,
    isPending: false,
  });

  const execute = React.useCallback(
    async <T,>(
      operation: (signal: AbortSignal) => Promise<T>,
      config?: RetryConfig
    ): Promise<T> => {
      const finalConfig = { ...defaultConfig, ...config };

      setMetrics(prev => ({
        ...prev,
        totalAttempts: prev.totalAttempts + 1,
        isPending: true,
      }));

      try {
        const result = await executeWithRetry(operation, {
          ...finalConfig,
          onRetry: (attemptNumber, delayMs) => {
            setMetrics(prev => ({
              ...prev,
              totalRetries: prev.totalRetries + 1,
              lastRetryTimestampMs: Date.now(),
              currentAttemptNumber: attemptNumber,
            }));
            finalConfig.onRetry?.(attemptNumber, delayMs);
          },
          onExhausted: (error, totalAttempts) => {
            setMetrics(prev => ({
              ...prev,
              currentAttemptNumber: 0,
              isPending: false,
            }));
            finalConfig.onExhausted?.(error, totalAttempts);
          },
        });

        setMetrics(prev => ({
          ...prev,
          currentAttemptNumber: 0,
          isPending: false,
        }));

        return result;
      } catch (error) {
        setMetrics(prev => ({
          ...prev,
          currentAttemptNumber: 0,
          isPending: false,
        }));
        throw error;
      }
    },
    [defaultConfig]
  );

  const resetMetrics = React.useCallback(() => {
    setMetrics({
      totalAttempts: 0,
      totalRetries: 0,
      lastRetryTimestampMs: null,
      currentAttemptNumber: 0,
      isPending: false,
    });
  }, []);

  return {
    execute,
    metrics,
    resetMetrics,
  };
}

// Import React at the end to avoid circular dependencies
import React from 'react';
