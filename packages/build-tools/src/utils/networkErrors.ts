import { CombinedError } from '@urql/core';

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

/** Errno code of the error or its causes; undici keeps it on cause, urql on networkError. */
export function findErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string') {
      return current.code;
    }
    current = current instanceof CombinedError ? current.networkError : current.cause;
  }
  return undefined;
}

export function findGraphqlErrorCode(error: unknown): string | undefined {
  if (!(error instanceof CombinedError)) {
    return undefined;
  }
  const code = error.graphQLErrors.at(0)?.extensions.errorCode;
  return typeof code === 'string' ? code : undefined;
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = findErrorCode(error);
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

export function isTransientGraphqlError(error: CombinedError): boolean {
  return (
    Boolean(error.networkError) ||
    error.response?.status >= 500 ||
    error.graphQLErrors.some(graphqlError => graphqlError.extensions.isTransient === true)
  );
}

// node-fetch throws type 'system' for a socket failure before the headers; after them it forwards
// ECONNRESET or ERR_STREAM_PREMATURE_CLOSE to the body. HTTP error responses never throw.
export function isTransferFailure(error: unknown): boolean {
  return (
    (error instanceof Error &&
      error.name === 'FetchError' &&
      'type' in error &&
      error.type === 'system') ||
    isConnectionInterruptedError(error) ||
    findErrorCode(error) === 'ERR_STREAM_PREMATURE_CLOSE'
  );
}
