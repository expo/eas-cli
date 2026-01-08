import { randomUUID } from 'crypto';

import { BuildTrigger, Job, Metadata } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { BuildContext } from '../context';

import { createMockLogger } from './utils/logger';

jest.mock('fs');
jest.mock('fs-extra');

describe('BuildContext', () => {
  it('should merge secrets', async () => {
    const robotAccessToken = randomUUID();
    await vol.promises.mkdir('/workingdir/eas-environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        secrets: {
          robotAccessToken,
          environmentSecrets: [
            {
              name: 'TEST_SECRET',
              value: 'test-secret-value',
            },
          ],
        },
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );

    ctx.updateJobInformation({} as Job, {} as Metadata);

    expect(ctx.job.secrets).toEqual({
      robotAccessToken,
      environmentSecrets: [
        {
          name: 'TEST_SECRET',
          value: 'test-secret-value',
        },
      ],
    });

    const newRobotAccessToken = randomUUID();
    ctx.updateJobInformation(
      {
        secrets: {
          robotAccessToken: newRobotAccessToken,
          environmentSecrets: [
            {
              name: 'TEST_SECRET',
              value: 'new-test-secret-value',
            },
            {
              name: 'TEST_SECRET_2',
              value: 'test-secret-value-2',
            },
          ],
        },
      } as Job,
      {} as Metadata
    );

    expect(ctx.job.secrets).toEqual({
      robotAccessToken: newRobotAccessToken,
      environmentSecrets: [
        { name: 'TEST_SECRET', value: 'test-secret-value' },
        { name: 'TEST_SECRET', value: 'new-test-secret-value' },
        { name: 'TEST_SECRET_2', value: 'test-secret-value-2' },
      ],
    });
  });

  it('should not lose workflowInterpolationContext', async () => {
    const robotAccessToken = randomUUID();
    await vol.promises.mkdir('/workingdir/eas-environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        secrets: {
          robotAccessToken,
          environmentSecrets: [
            {
              name: 'TEST_SECRET',
              value: 'test-secret-value',
            },
          ],
        },
        workflowInterpolationContext: {
          foo: 'bar',
        } as any,
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );

    ctx.updateJobInformation({} as Job, {} as Metadata);

    expect(ctx.job.workflowInterpolationContext).toEqual({
      foo: 'bar',
    });
  });
});
