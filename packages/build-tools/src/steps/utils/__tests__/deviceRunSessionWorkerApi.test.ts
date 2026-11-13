import { SystemError } from '@expo/eas-build-job';

import { CustomBuildContext } from '../../../customBuildContext';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  DEVICE_RUN_SESSION_TOKEN_HEADER,
  DeviceRunSessionWorkerApi,
  getDeviceRunSessionWorkerApi,
  requireDeviceRunSessionWorkerApi,
} from '../deviceRunSessionWorkerApi';

jest.mock('../../../utils/turtleFetch');
jest.unmock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');
type Response = InstanceType<typeof Response>;

const BASE_URL = 'https://api.expo.test/v2/';
const TOKEN = 'device-run-session-token-value';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createApi(): DeviceRunSessionWorkerApi {
  return new DeviceRunSessionWorkerApi(BASE_URL, TOKEN);
}

describe(getDeviceRunSessionWorkerApi, () => {
  it('returns null when the job has no device run session token', () => {
    expect(
      getDeviceRunSessionWorkerApi({
        env: { __API_SERVER_URL: 'https://api.expo.test' },
        expoApiV2BaseUrl: BASE_URL,
      } as unknown as CustomBuildContext)
    ).toBeNull();
    expect(
      getDeviceRunSessionWorkerApi({
        env: { EAS_DEVICE_RUN_SESSION_TOKEN: '' },
        expoApiV2BaseUrl: BASE_URL,
      } as unknown as CustomBuildContext)
    ).toBeNull();
  });

  it('uses the API v2 base URL of the context', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'in-progress' } }));
    const api = getDeviceRunSessionWorkerApi({
      env: { EAS_DEVICE_RUN_SESSION_TOKEN: TOKEN, __API_SERVER_URL: 'https://other.expo.test' },
      expoApiV2BaseUrl: BASE_URL,
    } as unknown as CustomBuildContext);

    await api!.getSessionAsync();

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      'https://api.expo.test/v2/device-run-session-worker/session',
      'GET',
      expect.anything()
    );
  });

  it('throws a system error when the token is set but no API URL is known', () => {
    expect(() =>
      getDeviceRunSessionWorkerApi({
        env: { EAS_DEVICE_RUN_SESSION_TOKEN: TOKEN },
      } as unknown as CustomBuildContext)
    ).toThrow(SystemError);
  });
});

describe(requireDeviceRunSessionWorkerApi, () => {
  it('returns the client when the job has a device run session token', () => {
    expect(
      requireDeviceRunSessionWorkerApi({
        env: { EAS_DEVICE_RUN_SESSION_TOKEN: TOKEN },
        expoApiV2BaseUrl: BASE_URL,
      } as unknown as CustomBuildContext)
    ).toBeInstanceOf(DeviceRunSessionWorkerApi);
  });

  it('throws a system error when the job has no device run session token', () => {
    const error = (() => {
      try {
        requireDeviceRunSessionWorkerApi({
          env: { __API_SERVER_URL: 'https://api.expo.test' },
          expoApiV2BaseUrl: BASE_URL,
        } as unknown as CustomBuildContext);
      } catch (err) {
        return err;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(SystemError);
    expect((error as Error).message).toMatch(
      /^This device run session job has no EAS_DEVICE_RUN_SESSION_TOKEN secret\./
    );
  });
});

describe(DeviceRunSessionWorkerApi, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it.each([
    {
      name: 'getSessionAsync',
      call: (api: DeviceRunSessionWorkerApi) => api.getSessionAsync(),
      method: 'GET',
      route: 'session',
      json: undefined,
      data: { id: 'drs-id', status: 'in-progress' },
      expected: { id: 'drs-id', status: 'in-progress' },
    },
    {
      name: 'startAsync',
      call: (api: DeviceRunSessionWorkerApi) =>
        api.startAsync({ remoteConfig: { type: 'agent-device', url: 'https://x.test' } }),
      method: 'POST',
      route: 'start',
      json: { remoteConfig: { type: 'agent-device', url: 'https://x.test' } },
      data: { id: 'drs-id', status: 'in-progress' },
      expected: { id: 'drs-id', status: 'in-progress' },
    },
    {
      name: 'stopAsync',
      call: (api: DeviceRunSessionWorkerApi) => api.stopAsync(),
      method: 'POST',
      route: 'stop',
      json: undefined,
      data: { id: 'drs-id', status: 'stopped' },
      expected: { id: 'drs-id', status: 'stopped' },
    },
    {
      name: 'createArtifactUploadSessionAsync',
      call: (api: DeviceRunSessionWorkerApi) =>
        api.createArtifactUploadSessionAsync({
          name: 'Screenshot',
          filename: 'screenshot.png',
          kind: 'screenshot',
          size: 12,
          metadata: { __eas_type: 'screenshot' },
          idempotencyKey: 'idempotency-key',
        }),
      method: 'POST',
      route: 'artifact-upload-sessions',
      headers: { 'Idempotency-Key': 'idempotency-key' },
      json: {
        name: 'Screenshot',
        filename: 'screenshot.png',
        kind: 'screenshot',
        size: 12,
        metadata: { __eas_type: 'screenshot' },
      },
      data: { uploadSession: { url: 'https://uploads.test/a', headers: { 'X-A': '1' } } },
      expected: { url: 'https://uploads.test/a', headers: { 'X-A': '1' } },
    },
    {
      name: 'createEventLogUploadSessionAsync',
      call: (api: DeviceRunSessionWorkerApi) => api.createEventLogUploadSessionAsync(),
      method: 'POST',
      route: 'event-log-upload-session',
      json: undefined,
      data: { uploadSession: { url: 'https://uploads.test/events', headers: {} } },
      expected: { url: 'https://uploads.test/events', headers: {} },
    },
    {
      name: 'createPreviewUploadSessionAsync',
      call: (api: DeviceRunSessionWorkerApi) => api.createPreviewUploadSessionAsync(),
      method: 'POST',
      route: 'preview-upload-session',
      json: undefined,
      data: { uploadSession: { url: 'https://uploads.test/preview', headers: {} } },
      expected: { url: 'https://uploads.test/preview', headers: {} },
    },
    {
      name: 'createPreviewUploadSessionAsync with metadata',
      call: (api: DeviceRunSessionWorkerApi) =>
        api.createPreviewUploadSessionAsync({
          metadata: { source: 'preview', width: 148, height: 320 },
        }),
      method: 'POST',
      route: 'preview-upload-session',
      json: { metadata: { source: 'preview', width: 148, height: 320 } },
      data: { uploadSession: { url: 'https://uploads.test/preview', headers: {} } },
      expected: { url: 'https://uploads.test/preview', headers: {} },
    },
    {
      name: 'fetchTurnIceServersAsync',
      call: (api: DeviceRunSessionWorkerApi) => api.fetchTurnIceServersAsync(),
      method: 'POST',
      route: 'turn-ice-servers',
      json: undefined,
      data: {
        iceServers: [
          { urls: ['stun:stun.test:3478'] },
          { urls: ['turn:turn.test:3478'], username: 'user', credential: 'secret' },
        ],
      },
      expected: [
        { urls: ['stun:stun.test:3478'] },
        { urls: ['turn:turn.test:3478'], username: 'user', credential: 'secret' },
      ],
    },
    {
      name: 'getApplicationAsync',
      call: (api: DeviceRunSessionWorkerApi) => api.getApplicationAsync(),
      method: 'GET',
      route: 'application',
      json: undefined,
      data: {
        build: {
          id: 'build-id',
          gitCommitHash: null,
          applicationArchiveUrl: 'https://expo.test/artifacts/eas/a.tar.gz',
        },
      },
      expected: {
        build: {
          id: 'build-id',
          gitCommitHash: null,
          applicationArchiveUrl: 'https://expo.test/artifacts/eas/a.tar.gz',
        },
      },
    },
  ])(
    '$name calls $method /v2/device-run-session-worker/$route with the session token header',
    async ({ call, method, route, headers, json, data, expected }) => {
      jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data }));

      await expect(call(createApi())).resolves.toEqual(expected);

      expect(jest.mocked(turtleFetch)).toHaveBeenCalledTimes(1);
      const [url, calledMethod, options] = jest.mocked(turtleFetch).mock.calls[0];
      expect(url).toBe(`https://api.expo.test/v2/device-run-session-worker/${route}`);
      expect(calledMethod).toBe(method);
      expect(options.headers).toEqual({ ...headers, [DEVICE_RUN_SESSION_TOKEN_HEADER]: TOKEN });
      expect(options.json).toEqual(json);
      expect(options).toEqual(expect.objectContaining({ retries: 0, shouldThrowOnNotOk: false }));
    }
  );

  it.each(['new', 'queued', 'starting', 'in-progress', 'stopped', 'errored'])(
    'returns the www status %s unchanged',
    async status => {
      jest
        .mocked(turtleFetch)
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status } }));

      await expect(createApi().getSessionAsync()).resolves.toEqual({ id: 'drs-id', status });
    }
  );

  it('rejects an application response without the build field', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data: { platform: 'ios' } }));

    await expect(createApi().getApplicationAsync({ retries: 3 })).rejects.toThrow(
      'GET /v2/device-run-session-worker/application returned an unexpected response'
    );
  });
});
