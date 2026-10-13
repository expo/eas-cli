import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import fetch from 'node-fetch';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { type CustomBuildContext } from '../../../customBuildContext';
import RemoteLoggerStream from '../../../logging/RemoteLoggerStream';
import { turtleFetch } from '../../../utils/turtleFetch';
import { downloadBuildAsync } from '../../functions/downloadBuild';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { startDeviceRunSessionEventCollectionAsync } from '../deviceRunSessionEvents';
import { startDeviceRunSessionPreview } from '../deviceRunSessionPreview';
import { loadScreenshotSessionAsync } from '../deviceRunSessionScreenshotNames';
import {
  DEVICE_RUN_SESSION_TOKEN_HEADER,
  DeviceRunSessionWorkerApi,
} from '../deviceRunSessionWorkerApi';
import {
  fetchWebPreviewTurnArgsAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../remoteDeviceRunSession';

jest.mock('node-fetch');
jest.mock('@ngrok/ngrok');
jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/turtleFetch');
jest.mock('../../../sentry');
jest.mock('../../../logging/HttpLogStream', () => ({
  __esModule: true,
  default: jest.fn(() => ({ write: jest.fn(), cleanUp: jest.fn(async () => undefined) })),
}));
jest.mock('../../../logging/RemoteLoggerStream', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    init: jest.fn(async () => undefined),
    write: jest.fn(),
    cleanUp: jest.fn(async () => undefined),
  })),
}));

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

const TOKEN = 'device-run-session-token-value';
const ROBOT_ACCESS_TOKEN = 'robot-access-token-value';
const API_V2_BASE_URL = 'https://api.expo.test/v2/';
const BUILD_ID = '0a8b5f3c-7c38-4a2f-9c0c-2a1f0e7d8b11';
const APPLICATION_ARCHIVE_URL = 'https://expo.test/artifacts/eas/app.tar.gz';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
} as unknown as bunyan;

function jsonResponse(body: unknown, status = 200): InstanceType<typeof Response> {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createCtx({ withToken }: { withToken: boolean }): CustomBuildContext {
  return {
    env: {
      __API_SERVER_URL: 'https://api.expo.test',
      EAS_BUILD_ID: 'job-run-id',
      ...(withToken ? { EAS_DEVICE_RUN_SESSION_TOKEN: TOKEN } : {}),
    },
    expoApiV2BaseUrl: API_V2_BASE_URL,
    job: { secrets: { robotAccessToken: ROBOT_ACCESS_TOKEN } },
    graphqlClient: {
      query: jest.fn(),
      mutation: jest.fn(),
    },
  } as unknown as CustomBuildContext;
}

function graphqlResult(data: unknown): { toPromise: () => Promise<{ data: unknown }> } {
  return { toPromise: async () => ({ data }) };
}

function expectWorkerApiCall(
  route: string,
  method: 'GET' | 'POST',
  options: Record<string, unknown> = {}
): void {
  expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
    `${API_V2_BASE_URL}device-run-session-worker/${route}`,
    method,
    expect.objectContaining({
      headers: { [DEVICE_RUN_SESSION_TOKEN_HEADER]: TOKEN },
      ...options,
    })
  );
}

async function waitForCallAsync(mock: jest.Mock): Promise<void> {
  for (let i = 0; i < 100 && mock.mock.calls.length === 0; i++) {
    await setImmediate();
  }
}

const env = { DEVICE_RUN_SESSION_ID: 'drs-id' } as unknown as BuildStepEnv;

const eventSource = {
  producer: 'test-producer',
  findEventFilesAsync: async () => [],
  sourceKeyForFile: () => 'source',
  parseLine: () => ({}),
};

beforeEach(() => {
  jest.mocked(turtleFetch).mockReset();
  jest.mocked(fetch).mockReset();
});

describe('with a device run session token', () => {
  it('polls the session status through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'STOPPED' } }));

    await waitForDeviceRunSessionStoppedAsync({ ctx, deviceRunSessionId: 'drs-id', logger });

    expectWorkerApiCall('session', 'GET', { retries: 0 });
    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
  });

  it('stops an idle session through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'STOPPED' } }));

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
      idleTimeout: { maxIdleTimeMinutes: 0, getLastEventObservedAt: () => undefined },
    });

    expectWorkerApiCall('stop', 'POST');
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('starts the session through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'IN_PROGRESS' } }));

    await uploadRemoteSessionConfigAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      remoteConfig: { type: 'agent-device' },
      logger,
    });

    expectWorkerApiCall('start', 'POST', { json: { remoteConfig: { type: 'agent-device' } } });
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('fails the start with a system error that does not contain the token', async () => {
    const ctx = createCtx({ withToken: true });
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'The session finished.' }] }, 403));

    const error = await uploadRemoteSessionConfigAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      remoteConfig: {},
      logger,
    }).catch(err => err);

    expect(error).toBeInstanceOf(SystemError);
    expect(error.message).toBe(
      'Failed to start device run session drs-id: POST /v2/device-run-session-worker/start failed with status 403: The session finished.'
    );
    expect(error.message).not.toContain(TOKEN);
  });

  it('fetches TURN ICE servers through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          iceServers: [
            { urls: ['stun:stun.test:3478'] },
            { urls: ['turn:turn.test:3478'], username: 'user', credential: 'credential' },
          ],
        },
      })
    );

    const args = await fetchWebPreviewTurnArgsAsync(ctx, { env, logger });

    expect(args).toEqual([
      '--stun-url',
      'stun:stun.test:3478',
      '--turn-url',
      'turn:turn.test:3478',
      '--turn-username',
      'user',
      '--turn-credential',
      'credential',
    ]);
    expectWorkerApiCall('turn-ice-servers', 'POST', { timeout: 5000, retries: 1 });
    expect(jest.mocked(turtleFetch)).toHaveBeenCalledTimes(1);
  });

  it('creates artifact upload sessions through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse({
        data: { uploadSession: { url: 'https://uploads.expo.test/artifact', headers: {} } },
      })
    );
    jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      artifactId: 'artifact-id',
      name: 'Report',
      filename: 'report.json',
      kind: 'test-report',
      metadata: { a: 'b' },
      size: 4,
      openStream: () => Readable.from(Buffer.from('data')),
    });

    expectWorkerApiCall('artifact-upload-sessions', 'POST', {
      json: {
        name: 'Report',
        filename: 'report.json',
        kind: 'test-report',
        metadata: { a: 'b' },
        size: 4,
      },
      signal: expect.any(AbortSignal),
    });
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      'https://uploads.expo.test/artifact',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('creates the event log upload session through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          uploadSession: { url: 'https://uploads.expo.test/events', headers: { 'X-A': '1' } },
        },
      })
    );

    const collection = await startDeviceRunSessionEventCollectionAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      source: eventSource,
      logger,
    });
    await collection.stopAsync();

    expectWorkerApiCall('event-log-upload-session', 'POST');
    expect(jest.mocked(RemoteLoggerStream)).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadMethod: {
          signedUrl: { url: 'https://uploads.expo.test/events', headers: { 'X-A': '1' } },
        },
      })
    );
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('creates the preview upload session through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse({
        data: { uploadSession: { url: 'https://uploads.expo.test/preview', headers: {} } },
      })
    );
    jest.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));

    const preview = startDeviceRunSessionPreview({
      ctx,
      deviceRunSessionId: 'drs-id',
      captureAsync: async () => Buffer.from('webp'),
      logger,
    });
    await waitForCallAsync(jest.mocked(fetch));
    await preview.stopAsync();

    expectWorkerApiCall('preview-upload-session', 'POST', { signal: expect.any(AbortSignal) });
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      'https://uploads.expo.test/preview',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('loads the screenshot naming details through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          platform: 'IOS',
          appSlug: 'session-app',
          build: {
            id: BUILD_ID,
            platform: 'IOS',
            appSlug: 'build-app',
            gitCommitHash: 'abc',
            applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
          },
        },
      })
    );

    await expect(loadScreenshotSessionAsync(ctx, 'drs-id', logger)).resolves.toEqual({
      platform: 'IOS',
      app: { slug: 'session-app' },
      build: { id: BUILD_ID, gitCommitHash: 'abc', app: { slug: 'build-app' } },
    });
    expectWorkerApiCall('application', 'GET', { signal: expect.any(AbortSignal), retries: 0 });
    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
  });

  it('downloads the session build from the worker API archive URL without an Authorization header', async () => {
    const ctx = createCtx({ withToken: true });
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          platform: 'IOS',
          appSlug: 'app',
          build: {
            id: BUILD_ID,
            platform: 'IOS',
            appSlug: 'app',
            gitCommitHash: null,
            applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
          },
        },
      })
    );
    jest.mocked(fetch).mockResolvedValueOnce(new Response('stop here', { status: 500 }));

    await expect(
      downloadBuildAsync({
        logger,
        buildId: BUILD_ID,
        graphqlClient: ctx.graphqlClient,
        deviceRunSessionWorkerApi: new DeviceRunSessionWorkerApi(API_V2_BASE_URL, TOKEN),
        robotAccessToken: ROBOT_ACCESS_TOKEN,
        extensions: ['app'],
      })
    ).rejects.toThrow('Unexpected response from server (500): stop here');

    expectWorkerApiCall('application', 'GET');
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      APPLICATION_ARCHIVE_URL,
      expect.objectContaining({ headers: undefined })
    );
    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
  });

  it('refuses to download a build that is not the session build', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(
        jsonResponse({ data: { platform: 'IOS', appSlug: 'app', build: null } })
      );

    const error = await downloadBuildAsync({
      logger,
      buildId: BUILD_ID,
      graphqlClient: createCtx({ withToken: true }).graphqlClient,
      deviceRunSessionWorkerApi: new DeviceRunSessionWorkerApi(API_V2_BASE_URL, TOKEN),
      robotAccessToken: ROBOT_ACCESS_TOKEN,
      extensions: ['app'],
    }).catch(err => err);

    expect(error).toBeInstanceOf(SystemError);
    expect(error.message).toContain(
      `Could not fetch build ${BUILD_ID}: this device run session runs no build`
    );
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('without a device run session token', () => {
  it('polls the session status with GraphQL', async () => {
    const ctx = createCtx({ withToken: false });
    jest
      .mocked(ctx.graphqlClient.query)
      .mockReturnValueOnce(
        graphqlResult({ deviceRunSessions: { byId: { id: 'drs-id', status: 'STOPPED' } } }) as never
      );

    await waitForDeviceRunSessionStoppedAsync({ ctx, deviceRunSessionId: 'drs-id', logger });

    expect(ctx.graphqlClient.query).toHaveBeenCalledWith(expect.anything(), {
      deviceRunSessionId: 'drs-id',
    });
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });

  it('stops an idle session with GraphQL', async () => {
    const ctx = createCtx({ withToken: false });
    jest.mocked(ctx.graphqlClient.mutation).mockReturnValueOnce(
      graphqlResult({
        deviceRunSession: { ensureDeviceRunSessionStopped: { id: 'drs-id', status: 'STOPPED' } },
      }) as never
    );

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
      idleTimeout: { maxIdleTimeMinutes: 0, getLastEventObservedAt: () => undefined },
    });

    expect(ctx.graphqlClient.mutation).toHaveBeenCalledWith(expect.anything(), {
      deviceRunSessionId: 'drs-id',
    });
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });

  it('starts the session with GraphQL', async () => {
    const ctx = createCtx({ withToken: false });
    jest.mocked(ctx.graphqlClient.mutation).mockReturnValueOnce(
      graphqlResult({
        deviceRunSession: { startDeviceRunSession: { id: 'drs-id', status: 'IN_PROGRESS' } },
      }) as never
    );

    await uploadRemoteSessionConfigAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      remoteConfig: { type: 'agent-device' },
      logger,
    });

    expect(ctx.graphqlClient.mutation).toHaveBeenCalledWith(expect.anything(), {
      deviceRunSessionId: 'drs-id',
      remoteConfig: { type: 'agent-device' },
    });
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });

  it('fetches TURN ICE servers from the device run sessions route with the robot token', async () => {
    const ctx = createCtx({ withToken: false });
    jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data: { iceServers: [] } }));

    await fetchWebPreviewTurnArgsAsync(ctx, { env, logger });

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      'https://api.expo.test/v2/device-run-sessions/drs-id/turn-ice-servers',
      'POST',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${ROBOT_ACCESS_TOKEN}` },
        timeout: 5000,
        retries: 1,
      })
    );
  });

  it('creates artifact upload sessions with GraphQL', async () => {
    const ctx = createCtx({ withToken: false });
    jest.mocked(ctx.graphqlClient.mutation).mockReturnValueOnce(
      graphqlResult({
        deviceRunSession: {
          createArtifactUploadSession: {
            uploadSession: { url: 'https://uploads.expo.test/artifact', headers: {} },
          },
        },
      }) as never
    );
    jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      artifactId: 'artifact-id',
      name: 'Report',
      filename: 'report.json',
      kind: undefined,
      size: 4,
      openStream: () => Readable.from(Buffer.from('data')),
    });

    expect(ctx.graphqlClient.mutation).toHaveBeenCalled();
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });

  it('creates the event log upload session with GraphQL', async () => {
    const ctx = createCtx({ withToken: false });
    jest.mocked(ctx.graphqlClient.mutation).mockReturnValueOnce(
      graphqlResult({
        deviceRunSession: {
          createEventLogUploadSession: {
            uploadSession: { url: 'https://uploads.expo.test/events', headers: {} },
          },
        },
      }) as never
    );

    const collection = await startDeviceRunSessionEventCollectionAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      source: eventSource,
      logger,
    });
    await collection.stopAsync();

    expect(ctx.graphqlClient.mutation).toHaveBeenCalledWith(expect.anything(), {
      deviceRunSessionId: 'drs-id',
    });
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });

  it('creates the preview upload session with GraphQL', async () => {
    const ctx = createCtx({ withToken: false });
    jest.mocked(ctx.graphqlClient.mutation).mockReturnValueOnce(
      graphqlResult({
        deviceRunSession: {
          createPreviewUploadSession: {
            uploadSession: { url: 'https://uploads.expo.test/preview', headers: {} },
          },
        },
      }) as never
    );
    jest.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));

    const preview = startDeviceRunSessionPreview({
      ctx,
      deviceRunSessionId: 'drs-id',
      captureAsync: async () => Buffer.from('webp'),
      logger,
    });
    await waitForCallAsync(jest.mocked(fetch));
    await preview.stopAsync();

    expect(ctx.graphqlClient.mutation).toHaveBeenCalled();
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });

  it('loads the screenshot naming details with GraphQL', async () => {
    const ctx = createCtx({ withToken: false });
    jest.mocked(ctx.graphqlClient.query).mockReturnValueOnce(
      graphqlResult({
        deviceRunSessions: {
          byId: { platform: 'ANDROID', app: { slug: 'app' }, build: null },
        },
      }) as never
    );

    await expect(loadScreenshotSessionAsync(ctx, 'drs-id', logger)).resolves.toEqual({
      platform: 'ANDROID',
      app: { slug: 'app' },
      build: null,
    });
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });

  it('looks up the build archive URL with GraphQL', async () => {
    const ctx = createCtx({ withToken: false });
    jest.mocked(ctx.graphqlClient.query).mockReturnValueOnce(
      graphqlResult({
        builds: {
          byId: {
            id: BUILD_ID,
            platform: 'IOS',
            artifacts: { applicationArchiveUrl: APPLICATION_ARCHIVE_URL },
          },
        },
      }) as never
    );
    jest.mocked(fetch).mockResolvedValueOnce(new Response('stop here', { status: 500 }));

    await expect(
      downloadBuildAsync({
        logger,
        buildId: BUILD_ID,
        graphqlClient: ctx.graphqlClient,
        deviceRunSessionWorkerApi: null,
        robotAccessToken: ROBOT_ACCESS_TOKEN,
        extensions: ['app'],
      })
    ).rejects.toThrow('Unexpected response from server (500)');

    expect(ctx.graphqlClient.query).toHaveBeenCalled();
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      APPLICATION_ARCHIVE_URL,
      expect.objectContaining({ headers: { Authorization: `Bearer ${ROBOT_ACCESS_TOKEN}` } })
    );
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });
});
