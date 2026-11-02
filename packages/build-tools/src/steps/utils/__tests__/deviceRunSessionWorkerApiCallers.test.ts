import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform } from '@expo/steps';
import fetch from 'node-fetch';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { type CustomBuildContext } from '../../../customBuildContext';
import RemoteLoggerStream from '../../../logging/RemoteLoggerStream';
import { Sentry } from '../../../sentry';
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
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'stopped' } }));

    await waitForDeviceRunSessionStoppedAsync({ ctx, deviceRunSessionId: 'drs-id', logger });

    expectWorkerApiCall('session', 'GET', {
      retries: 0,
      timeout: 30_000,
      signal: expect.any(AbortSignal),
    });
    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
  });

  it('stops an idle session through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'stopped' } }));

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
      idleTimeout: { maxIdleTimeMinutes: 0, getLastEventObservedAt: () => undefined },
    });

    expectWorkerApiCall('stop', 'POST', { timeout: 30_000 });
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('retries a transient failure when starting the session through the worker API', async () => {
    const ctx = createCtx({ withToken: true });
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'Service unavailable' }] }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'in-progress' } }));

    await uploadRemoteSessionConfigAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      remoteConfig: { type: 'agent-device' },
      logger,
    });

    expectWorkerApiCall('start', 'POST', { json: { remoteConfig: { type: 'agent-device' } } });
    expect(turtleFetch).toHaveBeenCalledTimes(2);
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('handles the structured stopped code without matching the message', async () => {
    const ctx = createCtx({ withToken: true });
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse(
        {
          errors: [
            { code: 'DEVICE_RUN_SESSION_ALREADY_STOPPED', message: 'A different explanation.' },
          ],
        },
        400
      )
    );
    await expect(
      uploadRemoteSessionConfigAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        remoteConfig: {},
        logger,
      })
    ).resolves.toBe('stopped');
    expect(turtleFetch).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Device run session drs-id was stopped during startup.'
    );
  });

  it.each([undefined, 'VALIDATION_ERROR'])('preserves an ordinary 400 with code %s', async code => {
    const ctx = createCtx({ withToken: true });
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(
        jsonResponse(
          { errors: [{ code, message: 'Device run session has already stopped.' }] },
          400
        )
      );
    await expect(
      uploadRemoteSessionConfigAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        remoteConfig: {},
        logger,
      })
    ).rejects.toBeInstanceOf(SystemError);
    expect(turtleFetch).toHaveBeenCalledTimes(1);
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

    const args = await fetchWebPreviewTurnArgsAsync(ctx, { logger });

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
    expectWorkerApiCall('turn-ice-servers', 'POST', { timeout: 5000, retries: 0 });
    expect(jest.mocked(turtleFetch)).toHaveBeenCalledTimes(1);
  });

  it('handles a stopped-session TURN response without a warning or retry', async () => {
    const ctx = createCtx({ withToken: true });
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(
        jsonResponse(
          { errors: [{ code: 'DEVICE_RUN_SESSION_ALREADY_STOPPED', message: 'Stopped.' }] },
          400
        )
      );

    await expect(fetchWebPreviewTurnArgsAsync(ctx, { logger })).resolves.toEqual([]);

    expect(logger.info).toHaveBeenCalledWith(
      'Device run session was stopped before TURN credentials were fetched.'
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Sentry.capture).not.toHaveBeenCalled();
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'VALIDATION_ERROR'])(
    'still warns on a TURN failure with code %s',
    async code => {
      const ctx = createCtx({ withToken: true });
      jest
        .mocked(turtleFetch)
        .mockResolvedValueOnce(
          jsonResponse(
            { errors: [{ code, message: 'Device run session has already stopped.' }] },
            400
          )
        );

      await expect(fetchWebPreviewTurnArgsAsync(ctx, { logger })).resolves.toEqual([]);

      expect(logger.warn).toHaveBeenCalled();
      expect(Sentry.capture).toHaveBeenCalled();
      expect(turtleFetch).toHaveBeenCalledTimes(1);
    }
  );

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

  it.each([
    [BuildRuntimePlatform.DARWIN, 'IOS'],
    [BuildRuntimePlatform.LINUX, 'ANDROID'],
  ] as const)(
    'loads the screenshot naming details through the worker API on a %s worker',
    async (runtimePlatform, platform) => {
      const ctx = { ...createCtx({ withToken: true }), runtimePlatform } as CustomBuildContext;
      jest.mocked(turtleFetch).mockResolvedValueOnce(
        jsonResponse({
          data: {
            build: {
              id: BUILD_ID,
              gitCommitHash: 'abc',
              applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
            },
          },
        })
      );

      await expect(loadScreenshotSessionAsync(ctx, 'drs-id', logger)).resolves.toEqual({
        platform,
        app: null,
        build: { id: BUILD_ID, gitCommitHash: 'abc', app: null },
      });
      expectWorkerApiCall('application', 'GET', { signal: expect.any(AbortSignal), retries: 0 });
      expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
    }
  );

  it('downloads the session build from the worker API archive URL without an Authorization header', async () => {
    const ctx = createCtx({ withToken: true });
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          build: {
            id: BUILD_ID,
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
    ).rejects.toThrow(
      `Failed to download the application archive for build ${BUILD_ID} (HTTP 500): stop here`
    );

    expectWorkerApiCall('application', 'GET');
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      APPLICATION_ARCHIVE_URL,
      expect.objectContaining({ headers: undefined })
    );
    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
  });

  it('refuses to download a build that is not the session build', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data: { build: null } }));

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

  it('reports a rejected build lookup as a system error, because the job sends no user input', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse(
        {
          errors: [
            {
              code: 'UNAUTHORIZED_ERROR',
              message: 'This device run session no longer accepts worker requests.',
            },
          ],
        },
        403
      )
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
      `Could not fetch build ${BUILD_ID} for this device run session: GET /v2/device-run-session-worker/application failed with status 403: This device run session no longer accepts worker requests.`
    );
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('without a device run session token', () => {
  const MISSING_TOKEN_MESSAGE =
    /^This device run session job has no EAS_DEVICE_RUN_SESSION_TOKEN secret\./;

  function expectMissingTokenError(error: unknown): void {
    expect(error).toBeInstanceOf(SystemError);
    expect((error as Error).message).toMatch(MISSING_TOKEN_MESSAGE);
  }

  function expectMissingTokenWarning(message: string): void {
    const warning = (jest.mocked(logger.warn).mock.calls as unknown[][]).find(
      ([, warningMessage]) => warningMessage === message
    );
    expect(warning).toBeDefined();
    expectMissingTokenError((warning![0] as { err: unknown }).err);
  }

  it('fails the status poll with a system error', async () => {
    const ctx = createCtx({ withToken: false });

    const error = await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
    }).catch(err => err);

    expectMissingTokenError(error);
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
  });

  it('logs the failed idle stop and ends the wait', async () => {
    const ctx = createCtx({ withToken: false });

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
      idleTimeout: { maxIdleTimeMinutes: 0, getLastEventObservedAt: () => undefined },
    });

    expectMissingTokenWarning(
      'Could not mark device run session drs-id as stopped. The session job ends anyway.'
    );
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('fails the start with a system error', async () => {
    const ctx = createCtx({ withToken: false });

    const error = await uploadRemoteSessionConfigAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      remoteConfig: { type: 'agent-device' },
      logger,
    }).catch(err => err);

    expectMissingTokenError(error);
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('falls back to no TURN ICE servers', async () => {
    const ctx = createCtx({ withToken: false });

    await expect(fetchWebPreviewTurnArgsAsync(ctx, { logger })).resolves.toEqual([]);

    expectMissingTokenWarning(
      'Could not fetch Cloudflare TURN ICE servers; the web preview will fall back to P2P/STUN.'
    );
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });

  it('fails the artifact upload with a system error before any PUT', async () => {
    const ctx = createCtx({ withToken: false });

    const error = await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      artifactId: 'artifact-id',
      name: 'Report',
      filename: 'report.json',
      kind: undefined,
      size: 4,
      openStream: () => Readable.from(Buffer.from('data')),
    }).catch(err => err);

    expectMissingTokenError(error);
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('runs the session without persisting events', async () => {
    const ctx = createCtx({ withToken: false });

    const collection = await startDeviceRunSessionEventCollectionAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      source: eventSource,
      logger,
    });
    await collection.stopAsync();

    expectMissingTokenWarning('Could not persist device run session events to the artifact.');
    expect(jest.mocked(RemoteLoggerStream)).not.toHaveBeenCalled();
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('logs the failed preview upload session and uploads no preview', async () => {
    const ctx = createCtx({ withToken: false });

    const preview = startDeviceRunSessionPreview({
      ctx,
      deviceRunSessionId: 'drs-id',
      captureAsync: async () => Buffer.from('webp'),
      logger,
    });
    await waitForCallAsync(jest.mocked(logger.warn));
    await preview.stopAsync();

    expectMissingTokenWarning('Could not refresh the session preview; retrying in 60 seconds.');
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
    expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
  });

  it('names screenshots with capture timestamps', async () => {
    const ctx = createCtx({ withToken: false });

    await expect(loadScreenshotSessionAsync(ctx, 'drs-id', logger)).resolves.toBeNull();

    expectMissingTokenWarning(
      'Could not load screenshot session details; using capture timestamps.'
    );
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
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
    ).rejects.toThrow(
      `Failed to download the application archive for build ${BUILD_ID} (HTTP 500): stop here`
    );

    expect(ctx.graphqlClient.query).toHaveBeenCalled();
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      APPLICATION_ARCHIVE_URL,
      expect.objectContaining({ headers: { Authorization: `Bearer ${ROBOT_ACCESS_TOKEN}` } })
    );
    expect(jest.mocked(turtleFetch)).not.toHaveBeenCalled();
  });
});
