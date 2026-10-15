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
