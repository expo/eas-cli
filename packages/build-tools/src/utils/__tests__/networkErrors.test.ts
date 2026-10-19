import { isConnectFailure, isConnectionInterruptedError } from '../networkErrors';

it.each([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
])('recognizes wrapped %s as a connection establishment failure', code => {
  const error = new Error('Request failed', {
    cause: new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect failed'), { code }),
    }),
  });
  expect(isConnectFailure(error)).toBe(true);
  expect(isConnectionInterruptedError(error)).toBe(false);
});

it.each(['ECONNRESET', 'UND_ERR_SOCKET'])(
  'requires caller-specific recovery for wrapped %s',
  code => {
    const error = new Error('Request failed', {
      cause: Object.assign(new Error('response lost'), { code }),
    });
    expect(isConnectFailure(error)).toBe(false);
    expect(isConnectionInterruptedError(error)).toBe(true);
  }
);

it.each(['ETIMEDOUT', 'CERT_HAS_EXPIRED', undefined])('does not automatically retry %s', code => {
  const error = Object.assign(new Error('Request failed'), { code });
  expect(isConnectFailure(error)).toBe(false);
  expect(isConnectionInterruptedError(error)).toBe(false);
});
