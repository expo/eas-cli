import { isConnectFailure, isConnectionInterruptedError } from '../networkErrors';

it.each([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
])('recognizes wrapped %s as a connection establishment failure', code => {
  const error = new Error('Request failed', {
    cause: new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect failed'), { code }),
    }),
  });
  expect(isConnectFailure(error)).toBe(true);
  expect(isConnectionInterruptedError(error)).toBe(false);
});

it.each(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET'])(
  'requires caller-specific recovery for wrapped %s',
  code => {
    const error = new Error('Request failed', {
      cause: Object.assign(new Error('response lost'), { code }),
    });
    expect(isConnectFailure(error)).toBe(false);
    expect(isConnectionInterruptedError(error)).toBe(true);
  }
);

it.each(['CERT_HAS_EXPIRED', undefined])('does not automatically retry %s', code => {
  const error = Object.assign(new Error('Request failed'), { code });
  expect(isConnectFailure(error)).toBe(false);
  expect(isConnectionInterruptedError(error)).toBe(false);
});
