import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { simulatorRequestFailureReason, simulatorRequestProperties } from '../requestAnalytics';

const properties = simulatorRequestProperties({
  projectId: 'project-123',
  type: 'serve-sim',
  platform: 'IOS',
  hasBuildId: false,
  hasArchiveUrl: false,
  expoGo: false,
  nonInteractive: true,
});

function networkError(fields: { code?: string; name?: string; causeCode?: string } = {}): Error {
  const error = new Error('fetch failed') as Error & { code?: string; cause?: { code?: string } };
  if (fields.name) {
    error.name = fields.name;
  }
  if (fields.code) {
    error.code = fields.code;
  }
  if (fields.causeCode) {
    error.cause = { code: fields.causeCode };
  }
  return error;
}

describe(simulatorRequestProperties, () => {
  it('names the funnel reference properties and leaves out an unset package version', () => {
    expect(properties).toEqual({
      project_id: 'project-123',
      origin: 'eas-cli',
      type: 'serve-sim',
      platform: 'ios',
      has_build_id: false,
      has_archive_url: false,
      expo_go: false,
      non_interactive: true,
    });
    expect(
      simulatorRequestProperties({
        projectId: 'p',
        type: 'argent',
        platform: 'ANDROID',
        hasBuildId: true,
        hasArchiveUrl: true,
        expoGo: true,
        packageVersion: '0.22.1',
        nonInteractive: false,
      })
    ).toMatchObject({ platform: 'android', requested_package_version: '0.22.1' });
  });
});

describe(simulatorRequestFailureReason, () => {
  it('reports a timeout from the error code, its cause, or the error name', () => {
    for (const error of [
      networkError({ code: 'ETIMEDOUT' }),
      networkError({ causeCode: 'UND_ERR_CONNECT_TIMEOUT' }),
      networkError({ name: 'AbortError' }),
      networkError({ name: 'TimeoutError' }),
    ]) {
      expect(simulatorRequestFailureReason(new CombinedError({ networkError: error }))).toBe(
        'timeout'
      );
    }
  });

  it('reports any other missing answer as a network error', () => {
    expect(
      simulatorRequestFailureReason(
        new CombinedError({ networkError: networkError({ code: 'ECONNRESET' }) })
      )
    ).toBe('network_error');
  });

  it('is null when the server answered, since www reports refusals', () => {
    expect(
      simulatorRequestFailureReason(
        new CombinedError({
          graphQLErrors: [new GraphQLError('Simulator sessions are not enabled')],
        })
      )
    ).toBeNull();
    expect(
      simulatorRequestFailureReason(new Error('Returned query result data is null!'))
    ).toBeNull();
    expect(
      simulatorRequestFailureReason(
        new CombinedError({
          networkError: new Error('Gateway Timeout'),
          response: { status: 504, statusText: 'Gateway Timeout' },
        })
      )
    ).toBeNull();
  });
});
