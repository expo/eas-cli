import fetch, { Response } from 'node-fetch';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createWaitForPosthogQueryFunction } from '../waitForPosthogQuery';

jest.mock('@expo/logger');
jest.mock('node-fetch');

function jsonResponse(data: unknown, { ok = true, status = 200 } = {}): Response {
  return { ok, status, json: async () => data } as unknown as Response;
}

const ENV = {
  POSTHOG_CLI_API_KEY: 'phx_test',
  POSTHOG_CLI_PROJECT_ID: '123',
  POSTHOG_CLI_HOST: 'https://us.posthog.com',
};

describe(createWaitForPosthogQueryFunction, () => {
  const fetchMock = jest.mocked(fetch);
  const waitForQuery = createWaitForPosthogQueryFunction();

  afterEach(() => {
    jest.resetAllMocks();
  });

  function createStep(
    callInputs: Record<string, unknown>,
    env: Record<string, string> = ENV
  ): ReturnType<typeof waitForQuery.createBuildStepFromFunctionCall> {
    return waitForQuery.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs,
      env,
      id: waitForQuery.id,
    });
  }

  it('resolves when the query returns true', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [[true]] }));
    const step = createStep({ query: 'SELECT count() > 0 FROM events' });

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init?.body as string).query).toEqual({
      kind: 'HogQLQuery',
      query: 'SELECT count() > 0 FROM events',
    });
  });

  it('resolves when the query returns a nonzero number', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [[1]] }));
    const step = createStep({ query: 'q' });

    await expect(step.executeAsync()).resolves.not.toThrow();
  });

  it('keeps polling until the query turns true', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [[0]] }))
      .mockResolvedValueOnce(jsonResponse({ results: [[true]] }));
    const step = createStep({ query: 'q', interval_seconds: 0.05, timeout_seconds: 5 });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps polling after a transient failure and clears when the query recovers', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ results: [[true]] }));
    const step = createStep({ query: 'q', interval_seconds: 0.05, timeout_seconds: 5 });

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when the query never returns true within the timeout', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [[false]] }));
    const step = createStep({ query: 'q', interval_seconds: 0.05, timeout_seconds: 0.1 });

    await expect(step.executeAsync()).rejects.toThrow(/did not return true within/);
  });

  it('throws when credentials are missing', async () => {
    const step = createStep({ query: 'q' }, {});

    await expect(step.executeAsync()).rejects.toThrow(/personal API key or project id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-positive interval', async () => {
    const step = createStep({ query: 'q', interval_seconds: 0 });

    await expect(step.executeAsync()).rejects.toThrow(/greater than 0/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a 403 without retrying', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 403 }));
    const step = createStep({ query: 'q' });

    await expect(step.executeAsync()).rejects.toThrow(/forbidden \(403\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
