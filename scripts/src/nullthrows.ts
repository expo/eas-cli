export function nullthrows<T>(value: T | null | undefined, message?: string): T {
  if (value !== null && value !== undefined) {
    return value;
  }

  const error = new Error(message !== undefined ? message : `Got unexpected ${value}`);
  (error as any).framesToPop = 1; // Skip nullthrows's own stack frame.
  throw error;
}
