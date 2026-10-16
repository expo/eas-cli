import { Response } from 'node-fetch';

import { GooglePlayApiError } from '../GooglePlayApiError';

jest.unmock('node-fetch');

function fromBody(error: unknown): Promise<GooglePlayApiError> {
  return GooglePlayApiError.fromResponseAsync(
    new Response(JSON.stringify({ error }), { status: 400 })
  );
}

it('keeps readable Google details and skips metadata, unknown types and malformed entries', async () => {
  const error = await fromBody({
    message: 'Precondition check failed.',
    errors: [{ reason: 'failedPrecondition' }],
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'APP_NOT_READY',
        metadata: { project: 'PRIVATE' },
      },
      {
        '@type': 'type.googleapis.com/google.rpc.PreconditionFailure',
        violations: [{ type: 'APP_SETUP', subject: 'PRIVATE', description: 'Complete setup.' }],
      },
      {
        '@type': 'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations: [{ field: 'releases[0]', description: 'Invalid rollout.' }],
      },
      { '@type': 'type.googleapis.com/google.rpc.DebugInfo', detail: 'PRIVATE' },
      { '@type': 'type.googleapis.com/google.rpc.PreconditionFailure', violations: 'invalid' },
      null,
    ],
  });
  expect(error).toMatchObject({
    apiMessage: 'Precondition check failed.',
    reasons: ['failedPrecondition'],
    details: ['APP_NOT_READY', 'APP_SETUP: Complete setup.', 'releases[0]: Invalid rollout.'],
  });
  expect(JSON.stringify(error.details)).not.toContain('PRIVATE');
});

it('retains the JSON response with bounded and redacted diagnostic fields', async () => {
  const error = await fromBody({
    message: 'Denied',
    status: 'FAILED_PRECONDITION',
    details: [
      {
        '@type': 'unknown',
        explanation: 'Useful extra detail',
        metadata: {
          access_token: 'SECRET',
          password: 'SECRET',
          url: 'https://example.com?token=SECRET',
          description: 'Bearer SECRET',
          private_key: 'SECRET',
        },
      },
    ],
    extra: 'x'.repeat(100000),
  });
  const body = JSON.stringify(error.responseBody);
  expect(body).toContain('Useful extra detail');
  expect(body).toContain('FAILED_PRECONDITION');
  expect(body).not.toContain('SECRET');
  expect(body.length).toBeLessThan(17000);
});

it('does not retain a non-JSON error response', async () => {
  const error = await GooglePlayApiError.fromResponseAsync(new Response('SECRET', { status: 502 }));
  expect(error.responseBody).toBeUndefined();
});

it('keeps the primary error when details is not a list', async () => {
  const error = await fromBody({ message: 'Denied', details: { '@type': 'unknown' } });
  expect(error).toMatchObject({ apiMessage: 'Denied', details: [] });
});

it('bounds the number and length of details', async () => {
  const error = await fromBody({
    message: 'Invalid request.',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations: Array.from({ length: 20 }, () => ({ description: 'x'.repeat(10_000) })),
      },
    ],
  });
  expect(error.details).toHaveLength(5);
  expect(error.details.every(detail => detail.length === 500)).toBe(true);
});
