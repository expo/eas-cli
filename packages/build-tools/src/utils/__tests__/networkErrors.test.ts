import { CombinedError } from '@urql/core';

import {
  describeError,
  findErrorCode,
  findGraphqlErrorCode,
  isConnectFailure,
  isConnectionInterruptedError,
  isTransferFailure,
  isTransientGraphqlError,
} from '../networkErrors';

const { FetchError } = jest.requireActual('node-fetch') as typeof import('node-fetch');

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

it('finds the errno code on the cause of an undici fetch failure', () => {
  const error = new CombinedError({
    networkError: new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    }),
  });
  expect(findErrorCode(error)).toBe('ECONNRESET');
  expect(findErrorCode(new Error('Request failed'))).toBeUndefined();
  expect(findErrorCode('Request failed')).toBeUndefined();
});

it('finds the www error code on a GraphQL error', () => {
  const error = new CombinedError({
    graphQLErrors: [
      { message: 'Too many requests', extensions: { errorCode: 'TOO_MANY_REQUESTS' } },
    ],
  });
  expect(findGraphqlErrorCode(error)).toBe('TOO_MANY_REQUESTS');
  expect(
    findGraphqlErrorCode(new CombinedError({ graphQLErrors: ['Build not found'] }))
  ).toBeUndefined();
  expect(findGraphqlErrorCode(new Error('Request failed'))).toBeUndefined();
});

it.each([
  ['Request failed', 'ECONNRESET', 'Request failed (ECONNRESET)'],
  ['read ECONNRESET', 'ECONNRESET', 'read ECONNRESET'],
  ['Request failed', undefined, 'Request failed'],
])('describes %p with code %p as %p', (message, code, expected) => {
  expect(describeError(Object.assign(new Error(message), { code }))).toBe(expected);
});

it('treats a missing response, a 5xx response or an isTransient GraphQL error as transient', () => {
  expect(
    isTransientGraphqlError(new CombinedError({ networkError: new Error('fetch failed') }))
  ).toBe(true);
  expect(
    isTransientGraphqlError(
      new CombinedError({ graphQLErrors: ['Internal Server Error'], response: { status: 503 } })
    )
  ).toBe(true);
  expect(
    isTransientGraphqlError(
      new CombinedError({
        graphQLErrors: [{ message: 'Database unavailable', extensions: { isTransient: true } }],
        response: { status: 200 },
      })
    )
  ).toBe(true);
  expect(
    isTransientGraphqlError(
      new CombinedError({ graphQLErrors: ['Build not found'], response: { status: 200 } })
    )
  ).toBe(false);
});

it.each([
  [
    'a node-fetch socket failure',
    new FetchError('request failed', 'system', { code: 'ECONNRESET' } as any),
    true,
  ],
  ['a node-fetch body size failure', new FetchError('too large', 'max-size'), false],
  ['a body reset', Object.assign(new Error('aborted'), { code: 'ECONNRESET' }), true],
  [
    'a body closed early',
    Object.assign(new Error('closed'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }),
    true,
  ],
  ['an HTTP error response', new Error('Unexpected response from server (500)'), false],
])('classifies %s as a transfer failure or not', (_label, error, expected) => {
  expect(isTransferFailure(error)).toBe(expected);
});
