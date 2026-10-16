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
  expect(JSON.stringify(error)).not.toContain('PRIVATE');
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
