import { SystemError } from '@expo/eas-build-job';
import { FetchError } from 'node-fetch';
import { z } from 'zod';

import { turtleFetch } from '../../../utils/turtleFetch';
import {
  WorkerApi,
  WorkerApiError,
  type WorkerApiRequestOptions,
  getExpoApiV2BaseUrl,
} from '../workerApi';

jest.mock('../../../utils/turtleFetch');
jest.unmock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');
type Response = InstanceType<typeof Response>;

const BASE_URL = 'https://api.expo.test/v2/test-worker/';
const AUTH = { authHeader: 'expo-test-worker-token', token: 'test-worker-token-value' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ThingSchema = z.object({ id: z.string() });

async function getThingAsync(options?: WorkerApiRequestOptions): Promise<{ id: string }> {
  return await new WorkerApi(BASE_URL, AUTH).requestAsync('GET', 'thing', ThingSchema, options);
}

async function createThingAsync(
  json: Record<string, unknown>,
  options: WorkerApiRequestOptions = {}
): Promise<{ id: string }> {
  return await new WorkerApi(BASE_URL, AUTH).requestAsync('POST', 'things', ThingSchema, {
    ...options,
    json,
  });
}

describe(getExpoApiV2BaseUrl, () => {
  it('uses the API v2 base URL of the context', () => {
    expect(
      getExpoApiV2BaseUrl({
        env: { __API_SERVER_URL: 'https://other.expo.test' },
        expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      })
    ).toBe('https://api.expo.test/v2/');
  });

  it('derives the API v2 base URL from __API_SERVER_URL when the context has none', () => {
    expect(getExpoApiV2BaseUrl({ env: { __API_SERVER_URL: 'https://api.expo.test' } })).toBe(
      'https://api.expo.test/v2/'
    );
  });

  it('throws a system error when no API URL is known', () => {
    expect(() => getExpoApiV2BaseUrl({ env: {} })).toThrow(SystemError);
  });
});

describe(WorkerApi, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it('resolves routes under the worker router and sends only the worker auth header', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data: { id: 'thing-id' } }));

    await expect(createThingAsync({ name: 'a' })).resolves.toEqual({ id: 'thing-id' });

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledTimes(1);
    const [url, method, options] = jest.mocked(turtleFetch).mock.calls[0];
    expect(url).toBe('https://api.expo.test/v2/test-worker/things');
    expect(method).toBe('POST');
    expect(options.headers).toEqual({ 'expo-test-worker-token': 'test-worker-token-value' });
    expect(options.json).toEqual({ name: 'a' });
    expect(options).toEqual(expect.objectContaining({ retries: 0, shouldThrowOnNotOk: false }));
  });

  it('passes the signal and timeout without enabling nested retries', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data: { id: 'thing-id' } }));
    const controller = new AbortController();

    await getThingAsync({ signal: controller.signal, timeoutMs: 5000, retries: 1 });

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      expect.any(String),
      'GET',
      expect.objectContaining({ signal: controller.signal, timeout: 5000, retries: 0 })
    );
  });

  it('reports the API v2 error message, code and status without the token', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse(
        {
          errors: [
            {
              code: 'UNAUTHORIZED_ERROR',
              message: 'This worker no longer accepts requests.',
            },
          ],
        },
        403
      )
    );

    const error = await createThingAsync({}).catch(err => err);

    expect(error).toBeInstanceOf(WorkerApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('UNAUTHORIZED_ERROR');
    expect(error.message).toBe(
      'POST /v2/test-worker/things failed with status 403: This worker no longer accepts requests.'
    );
    expect(error.message).not.toContain(AUTH.token);
  });

  it('reports the status text when the error response is not an API v2 error', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(
        new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })
      );

    const error = await getThingAsync().catch(err => err);

    expect(error).toBeInstanceOf(WorkerApiError);
    expect(error.status).toBe(502);
    expect(error.message).toBe('GET /v2/test-worker/thing failed with status 502: Bad Gateway');
  });

  it('reports a request that failed before www responded', async () => {
    const reason = new Error('socket hang up');
    jest.mocked(turtleFetch).mockRejectedValueOnce(reason);

    const error = await getThingAsync().catch(err => err);

    expect(error).toBeInstanceOf(WorkerApiError);
    expect(error.status).toBeUndefined();
    expect(error.isTransient).toBe(true);
    expect(error.cause).toBe(reason);
    expect(error.message).toContain('failed before www responded: socket hang up');
  });

  it('rejects a response that does not match the route contract', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data: { id: 1 } }));

    await expect(getThingAsync({ retries: 3 })).rejects.toThrow(
      'GET /v2/test-worker/thing returned an unexpected response'
    );
  });

  it('rejects a successful response that is not JSON', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await expect(getThingAsync({ retries: 3 })).rejects.toThrow(
      'GET /v2/test-worker/thing returned a response that is not JSON.'
    );
  });
});

describe('worker API retries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(turtleFetch).mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([429, 500, 502, 503, 504])('recovers from HTTP %s', async status => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(new Response('unavailable', { status }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'thing-id' } }));
    const result = createThingAsync({}, { retries: 3, timeoutMs: 30_000 });
    const assertion = expect(result).resolves.toEqual({ id: 'thing-id' });
    await jest.runAllTimersAsync();
    await assertion;
    expect(turtleFetch).toHaveBeenCalledTimes(2);
    expect(jest.mocked(turtleFetch).mock.calls[1]).toEqual(jest.mocked(turtleFetch).mock.calls[0]);
    expect(jest.mocked(turtleFetch).mock.calls[0][2]).toMatchObject({
      retries: 0,
      timeout: 30_000,
    });
  });

  it('sends the same idempotency key on every attempt', async () => {
    jest
      .mocked(turtleFetch)
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'thing-id' } }));
    const assertion = expect(
      new WorkerApi(BASE_URL, AUTH).requestAsync('POST', 'things', ThingSchema, {
        json: {},
        idempotencyKey: 'idempotency-key',
        retries: 3,
      })
    ).resolves.toEqual({ id: 'thing-id' });
    await jest.runAllTimersAsync();
    await assertion;
    expect(jest.mocked(turtleFetch).mock.calls.map(([, , options]) => options.headers)).toEqual(
      Array.from({ length: 3 }, () => ({
        'expo-test-worker-token': 'test-worker-token-value',
        'Idempotency-Key': 'idempotency-key',
      }))
    );
  });

  it('recovers from a network failure', async () => {
    jest
      .mocked(turtleFetch)
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'thing-id' } }));
    const assertion = expect(getThingAsync({ retries: 3 })).resolves.toEqual({
      id: 'thing-id',
    });
    await jest.runAllTimersAsync();
    await assertion;
    expect(turtleFetch).toHaveBeenCalledTimes(2);
  });

  it('exhausts three retries with exponential backoff', async () => {
    jest
      .mocked(turtleFetch)
      .mockImplementation(async () => new Response('unavailable', { status: 503 }));
    const assertion = expect(createThingAsync({}, { retries: 3 })).rejects.toMatchObject({
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
    await expect(createThingAsync({}, { retries: 3 })).rejects.toMatchObject({
      status,
    });
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry without an explicit retry count', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(createThingAsync({})).rejects.toMatchObject({ status: 503 });
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit retry count', async () => {
    jest
      .mocked(turtleFetch)
      .mockImplementation(async () => new Response('unavailable', { status: 503 }));
    const assertion = expect(getThingAsync({ retries: 1 })).rejects.toMatchObject({
      status: 503,
    });
    await jest.runAllTimersAsync();
    await assertion;
    expect(turtleFetch).toHaveBeenCalledTimes(2);
  });

  it('does not send another request after cancellation during backoff', async () => {
    const controller = new AbortController();
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const assertion = expect(
      getThingAsync({ signal: controller.signal, retries: 3 })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await jest.runAllTimersAsync();
    await assertion;
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });

  it('does not send an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const assertion = expect(
      getThingAsync({ signal: controller.signal, retries: 3 })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await jest.runAllTimersAsync();
    await assertion;
    expect(turtleFetch).not.toHaveBeenCalled();
  });

  it.each(['system', 'body-timeout'])(
    'retries a response body transport failure (%s)',
    async type => {
      const response = jsonResponse({});
      jest
        .spyOn(response, 'json')
        .mockRejectedValueOnce(new FetchError('connection interrupted', type));
      jest
        .mocked(turtleFetch)
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'thing-id' } }));
      const assertion = expect(createThingAsync({}, { retries: 3 })).resolves.toEqual({
        id: 'thing-id',
      });
      await jest.runAllTimersAsync();
      await assertion;
      expect(turtleFetch).toHaveBeenCalledTimes(2);
    }
  );
});
