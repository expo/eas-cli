import { FetchError } from 'node-fetch';

export function isTransientGooglePlayStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

export function isNetworkRetryable(error: unknown): boolean {
  const visited = new Set<Error>();
  while (error instanceof Error && !visited.has(error)) {
    if (error instanceof FetchError && error.type === 'system') {
      return true;
    }
    visited.add(error);
    error = error.cause;
  }
  return false;
}
