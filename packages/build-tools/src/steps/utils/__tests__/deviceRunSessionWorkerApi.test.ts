import { SystemError } from '@expo/eas-build-job';
import { FetchError } from 'node-fetch';

import { CustomBuildContext } from '../../../customBuildContext';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  DEVICE_RUN_SESSION_TOKEN_HEADER,
  DeviceRunSessionWorkerApi,
  DeviceRunSessionWorkerApiError,
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

  it('derives the API v2 base URL from __API_SERVER_URL when the context has none', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'in-progress' } }));
    const api = getDeviceRunSessionWorkerApi({
      env: { EAS_DEVICE_RUN_SESSION_TOKEN: TOKEN, __API_SERVER_URL: 'https://api.expo.test' },
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
        }),
      method: 'POST',
      route: 'artifact-upload-sessions',
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
    async ({ call, method, route, json, data, expected }) => {
      jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data }));

      await expect(call(createApi())).resolves.toEqual(expected);

      expect(jest.mocked(turtleFetch)).toHaveBeenCalledTimes(1);
      const [url, calledMethod, options] = jest.mocked(turtleFetch).mock.calls[0];
      expect(url).toBe(`https://api.expo.test/v2/device-run-session-worker/${route}`);
      expect(calledMethod).toBe(method);
      expect(options.headers).toEqual({ [DEVICE_RUN_SESSION_TOKEN_HEADER]: TOKEN });
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

    await expect(createApi().getApplicationAsync()).rejects.toThrow(
      'GET /v2/device-run-session-worker/application returned an unexpected response'
    );
  });

  it('passes the signal and timeout without enabling nested retries', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data: { iceServers: [] } }));
    const controller = new AbortController();

    await createApi().fetchTurnIceServersAsync({
      signal: controller.signal,
      timeoutMs: 5000,
      retries: 1,
    });

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      expect.any(String),
      'POST',
      expect.objectContaining({ signal: controller.signal, timeout: 5000, retries: 0 })
    );
  });

  it('reports the API v2 error message and status without the token', async () => {
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

    const error = await createApi()
      .stopAsync()
      .catch(err => err);

    expect(error).toBeInstanceOf(DeviceRunSessionWorkerApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe(
      'POST /v2/device-run-session-worker/stop failed with status 403: This device run session no longer accepts worker requests.'
    );
    expect(error.message).not.toContain(TOKEN);
  });

  it('reports the status text when the error response is not an API v2 error', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(
        new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })
      );

    const error = await createApi()
      .getSessionAsync({ retries: 0 })
      .catch(err => err);

    expect(error).toBeInstanceOf(DeviceRunSessionWorkerApiError);
    expect(error.status).toBe(502);
    expect(error.message).toBe(
      'GET /v2/device-run-session-worker/session failed with status 502: Bad Gateway'
    );
  });

  it('reports a request that failed before www responded', async () => {
    const reason = new Error('socket hang up');
    jest.mocked(turtleFetch).mockRejectedValueOnce(reason);

    const error = await createApi()
      .getSessionAsync({ retries: 0 })
      .catch(err => err);

    expect(error).toBeInstanceOf(DeviceRunSessionWorkerApiError);
    expect(error.status).toBeUndefined();
    expect(error.cause).toBe(reason);
    expect(error.message).toContain('failed before www responded: socket hang up');
  });

  it('rejects a response that does not match the route contract', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'STOPPED' } }));

    await expect(createApi().getSessionAsync()).rejects.toThrow(
      'GET /v2/device-run-session-worker/session returned an unexpected response'
    );
  });

  it('rejects a successful response that is not JSON', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await expect(createApi().getSessionAsync()).rejects.toThrow(
      'GET /v2/device-run-session-worker/session returned a response that is not JSON.'
    );
  });
});

describe('device run session worker API retries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(turtleFetch).mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([429, 500, 502, 503, 504])(
    'recovers from HTTP %s when starting a session',
    async status => {
      jest
        .mocked(turtleFetch)
        .mockResolvedValueOnce(new Response('unavailable', { status }))
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'in-progress' } }));
      const result = createApi().startAsync({ remoteConfig: { url: 'https://preview.test' } });
      const assertion = expect(result).resolves.toEqual({ id: 'drs-id', status: 'in-progress' });
      await jest.runAllTimersAsync();
      await assertion;
      expect(turtleFetch).toHaveBeenCalledTimes(2);
      expect(jest.mocked(turtleFetch).mock.calls[1]).toEqual(
        jest.mocked(turtleFetch).mock.calls[0]
      );
      expect(jest.mocked(turtleFetch).mock.calls[0][2]).toMatchObject({
        retries: 0,
        timeout: 30_000,
      });
    }
  );

  it('recovers from a network failure', async () => {
    jest
      .mocked(turtleFetch)
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'stopped' } }));
    const assertion = expect(createApi().stopAsync()).resolves.toEqual({
      id: 'drs-id',
      status: 'stopped',
    });
    await jest.runAllTimersAsync();
    await assertion;
    expect(turtleFetch).toHaveBeenCalledTimes(2);
  });

  it('exhausts three retries with exponential backoff', async () => {
    jest
      .mocked(turtleFetch)
      .mockImplementation(async () => new Response('unavailable', { status: 503 }));
    const assertion = expect(createApi().startAsync({ remoteConfig: {} })).rejects.toMatchObject({
      status: 503,
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(turtleFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(turtleFetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2000);
    expect(turtleFetch).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(4000);
    await assertion;
    expect(turtleFetch).toHaveBeenCalledTimes(4);
  });

  it.each([400, 401, 403, 404, 409])('does not retry HTTP %s', async status => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response('refused', { status }));
    await expect(createApi().startAsync({ remoteConfig: {} })).rejects.toMatchObject({ status });
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });

  it('lets polling disable retries', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(createApi().getSessionAsync({ retries: 0 })).rejects.toMatchObject({
      status: 503,
    });
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit retry count', async () => {
    jest
      .mocked(turtleFetch)
      .mockImplementation(async () => new Response('unavailable', { status: 503 }));
    const assertion = expect(
      createApi().fetchTurnIceServersAsync({ retries: 1 })
    ).rejects.toMatchObject({ status: 503 });
    await jest.runAllTimersAsync();
    await assertion;
    expect(turtleFetch).toHaveBeenCalledTimes(2);
  });

  it('does not send another request after cancellation during backoff', async () => {
    const controller = new AbortController();
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const assertion = expect(
      createApi().getSessionAsync({ signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await jest.runAllTimersAsync();
    await assertion;
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });
});

describe('device run session retry safety', () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it('does not replay artifact creation after a transient failure', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(
      createApi().createArtifactUploadSessionAsync({
        name: 'report',
        filename: 'report.json',
        size: 1,
      })
    ).rejects.toMatchObject({ status: 503 });
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });

  it('does not send an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createApi().getSessionAsync({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(turtleFetch).not.toHaveBeenCalled();
  });

  it.each(['system', 'body-timeout'])(
    'retries a response body transport failure (%s)',
    async type => {
      jest.useFakeTimers();
      try {
        const response = jsonResponse({});
        jest
          .spyOn(response, 'json')
          .mockRejectedValueOnce(new FetchError('connection interrupted', type));
        jest
          .mocked(turtleFetch)
          .mockResolvedValueOnce(response)
          .mockResolvedValueOnce(jsonResponse({ data: { id: 'drs-id', status: 'in-progress' } }));
        const assertion = expect(
          createApi().startAsync({ remoteConfig: {} })
        ).resolves.toMatchObject({ status: 'in-progress' });
        await jest.runAllTimersAsync();
        await assertion;
        expect(turtleFetch).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    }
  );
});
