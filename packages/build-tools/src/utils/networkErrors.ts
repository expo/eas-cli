import { FetchError } from 'node-fetch';

export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

// Repeating a request after a transport failure is only safe when its caller permits it.
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

const CONNECT_FAILURE_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
]);

export function isConnectFailure(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      CONNECT_FAILURE_CODES.has(current.code)
    ) {
      return true;
    }
  }
  return false;
}

// The server may already have applied a request. The caller must decide whether repetition is safe.
export function isConnectionInterruptedError(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ('code' in current && (current.code === 'ECONNRESET' || current.code === 'UND_ERR_SOCKET')) {
      return true;
    }
  }
  return false;
}
