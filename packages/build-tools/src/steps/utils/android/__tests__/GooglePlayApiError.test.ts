import { Response } from 'node-fetch';

import { GooglePlayApiError } from '../GooglePlayApiError';
import { GooglePlayUtils } from '../GooglePlayUtils';

jest.unmock('node-fetch');

it('keeps the primary error when a detail is malformed', async () => {
  const error = await GooglePlayApiError.fromResponseAsync(
    new Response(
      JSON.stringify({
        error: {
          message: 'Denied',
          details: [
            null,
            {
              '@type': 'type.googleapis.com/google.rpc.PreconditionFailure',
              violations: 'invalid',
            },
          ],
        },
      }),
      { status: 403 }
    )
  );
  expect(error.apiMessage).toBe('Denied');
  expect(error.diagnostics).toBe('');
});

it('does not include a non-JSON response body', async () => {
  const error = await GooglePlayApiError.fromResponseAsync(
    new Response('PRIVATE', { status: 502 })
  );
  expect(error.status).toBe(502);
  expect(error.message).not.toContain('PRIVATE');
});

it('keeps useful precondition details in the error message without retaining arbitrary data', async () => {
  const error = await GooglePlayApiError.fromResponseAsync(
    new Response(
      JSON.stringify({
        error: {
          message: 'Precondition check failed.',
          status: 'FAILED_PRECONDITION',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.PreconditionFailure',
              violations: [
                { type: 'RELEASE_STATE', description: 'Complete app setup.', subject: 'PRIVATE' },
              ],
            },
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'APP_NOT_READY',
              domain: 'androidpublisher.googleapis.com',
              metadata: { token: 'PRIVATE' },
            },
            { '@type': 'unknown', token: 'PRIVATE' },
          ],
        },
      }),
      { status: 400 }
    ),
    undefined,
    'update track'
  );
  expect(error.message).toContain('FAILED_PRECONDITION');
  const mapped = GooglePlayUtils.mapGooglePlayError(error, 'com.example.app');
  expect(mapped).toMatchObject({ message: expect.stringContaining('Operation: update track') });
  expect(mapped).toMatchObject({ message: expect.stringContaining('Complete app setup.') });
  expect(error.message).toContain('Complete app setup.');
  expect(error.message).toContain('APP_NOT_READY');
  expect(JSON.stringify(error)).not.toContain('PRIVATE');
});

it('bounds diagnostics and removes URLs and bearer tokens', async () => {
  const error = await GooglePlayApiError.fromResponseAsync(
    new Response(
      JSON.stringify({
        error: {
          message: 'See https://example.com?token=PRIVATE Bearer PRIVATE',
          details: Array.from({ length: 100 }, () => ({
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [{ field: 'release', description: 'x'.repeat(10000) }],
          })),
        },
      }),
      { status: 400 }
    )
  );
  expect(error.message).not.toContain('PRIVATE');
  expect(error.message.length).toBeLessThan(5000);
});
