/**
 * Failure classes shared by adapters, workers and the job ledger
 * (QUEUE-ARCHITECTURE §3; mirrored by CHECK constraints in the database).
 */
export const FAILURE_CLASSES = [
  'transient',
  'rate_limited',
  'authorization',
  'invalid_input',
  'dependency_down',
  'permanent',
  'unknown',
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** Only these classes may be retried automatically, and only a bounded number of times. */
export const RETRYABLE_FAILURE_CLASSES: readonly FailureClass[] = ['transient', 'dependency_down', 'unknown'];
