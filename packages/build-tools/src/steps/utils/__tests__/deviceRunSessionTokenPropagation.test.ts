import { EnvironmentSecretType, Generic } from '@expo/eas-build-job';
import { BuildStepGlobalContext } from '@expo/steps';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { BuildContext } from '../../../context';
import { CustomBuildContext } from '../../../customBuildContext';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  DEVICE_RUN_SESSION_TOKEN_ENV,
  DEVICE_RUN_SESSION_TOKEN_HEADER,
  getDeviceRunSessionTokenFromEnvironmentSecrets,
  getDeviceRunSessionWorkerApi,
} from '../deviceRunSessionWorkerApi';

jest.mock('../../../utils/turtleFetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

const API_V2_BASE_URL = 'https://api.expo.test/v2/';

function createSessionJob(
  environmentSecrets: { name: string; type: EnvironmentSecretType; value: string }[]
): Generic.Job {
  return {
    triggeredBy: 'GIT_BASED_INTEGRATION',
    steps: [],
    secrets: { robotAccessToken: 'robot-access-token', environmentSecrets },
    builderEnvironment: { env: { DEVICE_RUN_SESSION_ID: 'drs-id' } },
  } as unknown as Generic.Job;
}

function createCustomBuildContext(job: Generic.Job): CustomBuildContext<Generic.Job> {
  const buildCtx = new BuildContext(job, {
    env: { __API_SERVER_URL: 'https://api.expo.test' },
    logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
    logger: createMockLogger(),
    uploadArtifact: jest.fn(),
    workingdir: '',
    expoApiV2BaseUrl: API_V2_BASE_URL,
  });
  return new CustomBuildContext(buildCtx);
}

async function getSentTokenAsync(ctx: CustomBuildContext): Promise<string | undefined> {
  jest.mocked(turtleFetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ data: { id: 'drs-id', status: 'in-progress' } }), {
      status: 200,
    })
  );
  await getDeviceRunSessionWorkerApi(ctx)!.getSessionAsync();
  const [url, , options] = jest.mocked(turtleFetch).mock.calls[0];
  expect(url).toBe(`${API_V2_BASE_URL}device-run-session-worker/session`);
  return (options.headers as Record<string, string>)[DEVICE_RUN_SESSION_TOKEN_HEADER];
}

describe('device run session token propagation', () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it('makes the environment secret reach the worker API client and the step env', async () => {
    const job = createSessionJob([
      { name: 'NGROK_AUTHTOKEN', type: EnvironmentSecretType.STRING, value: 'ngrok' },
      { name: DEVICE_RUN_SESSION_TOKEN_ENV, type: EnvironmentSecretType.STRING, value: 'token-a' },
    ]);
    const ctx = createCustomBuildContext(job);

    expect(new BuildStepGlobalContext(ctx, false).env[DEVICE_RUN_SESSION_TOKEN_ENV]).toBe(
      'token-a'
    );
    await expect(getSentTokenAsync(ctx)).resolves.toBe('token-a');
  });

  it('resolves duplicate secrets to the same token in the build env and the worker', async () => {
    const environmentSecrets = [
      { name: DEVICE_RUN_SESSION_TOKEN_ENV, type: EnvironmentSecretType.STRING, value: 'token-a' },
      { name: DEVICE_RUN_SESSION_TOKEN_ENV, type: EnvironmentSecretType.STRING, value: 'token-b' },
    ];
    const ctx = createCustomBuildContext(createSessionJob(environmentSecrets));

    const workerToken = getDeviceRunSessionTokenFromEnvironmentSecrets(environmentSecrets);
    expect(workerToken).toBe('token-b');
    await expect(getSentTokenAsync(ctx)).resolves.toBe(workerToken);
  });

  it('returns no client when the job has no session token', () => {
    const ctx = createCustomBuildContext(
      createSessionJob([
        { name: 'NGROK_AUTHTOKEN', type: EnvironmentSecretType.STRING, value: 'ngrok' },
      ])
    );

    expect(getDeviceRunSessionWorkerApi(ctx)).toBeNull();
  });
});

describe(getDeviceRunSessionTokenFromEnvironmentSecrets, () => {
  it('returns null without secrets or without the token', () => {
    expect(getDeviceRunSessionTokenFromEnvironmentSecrets(undefined)).toBeNull();
    expect(
      getDeviceRunSessionTokenFromEnvironmentSecrets([
        { name: 'OTHER', type: EnvironmentSecretType.STRING, value: 'x' },
      ])
    ).toBeNull();
  });

  it('returns null when the last secret with the name is a file secret', () => {
    expect(
      getDeviceRunSessionTokenFromEnvironmentSecrets([
        { name: DEVICE_RUN_SESSION_TOKEN_ENV, type: EnvironmentSecretType.STRING, value: 'a' },
        { name: DEVICE_RUN_SESSION_TOKEN_ENV, type: EnvironmentSecretType.FILE, value: 'Yg==' },
      ])
    ).toBeNull();
  });
});
