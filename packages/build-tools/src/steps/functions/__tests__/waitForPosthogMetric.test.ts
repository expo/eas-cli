import fetch, { Response } from 'node-fetch';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createWaitForPosthogMetricFunction } from '../waitForPosthogMetric';

jest.mock('@expo/logger');
jest.mock('node-fetch');

function jsonResponse(data: unknown, { ok = true, status = 200 } = {}): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

const ENV = {
  POSTHOG_CLI_API_KEY: 'phx_test',
  POSTHOG_CLI_PROJECT_ID: '123',
  POSTHOG_CLI_HOST: 'https://us.posthog.com',
};

describe(createWaitForPosthogMetricFunction, () => {
  const fetchMock = jest.mocked(fetch);
  const waitForMetric = createWaitForPosthogMetricFunction();

  afterEach(() => {
    jest.resetAllMocks();
  });

  function createStep(
    callInputs: Record<string, unknown>,
    env: Record<string, string> = ENV
  ): ReturnType<typeof waitForMetric.createBuildStepFromFunctionCall> {
    return waitForMetric.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs,
      env,
      id: waitForMetric.id,
    });
  }

  it('clears when the metric already meets the condition (blocking query)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [[3]] }));
    const step = createStep({
      query: 'select count() from events',
      operator: 'lt',
      threshold: '5',
    });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us.posthog.com/api/projects/123/query/');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      query: { kind: 'HogQLQuery' },
      refresh: 'blocking',
    });
    expect(step.outputById.get('value')!.value).toBe('3');
  });

  it('throws when credentials are missing', async () => {
    const step = createStep({ query: 'q', operator: 'lt', threshold: '5' }, {});

    await expect(step.executeAsync()).rejects.toThrow(
      /Missing PostHog credentials: personal API key, project id/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on an invalid operator', async () => {
    const step = createStep({ query: 'q', operator: 'between', threshold: '5' });

    await expect(step.executeAsync()).rejects.toThrow(/Invalid "operator"/);
  });

  it('rejects an Object.prototype key as an operator', async () => {
    const step = createStep({ query: 'q', operator: 'toString', threshold: '5' });

    await expect(step.executeAsync()).rejects.toThrow(/Invalid "operator"/);
  });

  it('throws with the PostHog error detail when the query fails to run', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: 'Malformed HogQL query' }, { ok: false, status: 400 })
    );
    const step = createStep({ query: 'bad', operator: 'lt', threshold: '5' });

    await expect(step.executeAsync()).rejects.toThrow(
      /failed with status 400: Malformed HogQL query/
    );
  });

  it('retries after a transient 500 and clears when the metric recovers', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ results: [[1]] }));
    const step = createStep({
      query: 'q',
      operator: 'lt',
      threshold: '5',
      interval_seconds: 0.05,
      timeout_seconds: 5,
    });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps polling while the query returns no numeric value', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [['not-a-number']] }))
      .mockResolvedValueOnce(jsonResponse({ results: [[2]] }));
    const step = createStep({
      query: 'q',
      operator: 'lt',
      threshold: '5',
      interval_seconds: 0.05,
      timeout_seconds: 5,
    });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a query-shape problem when no numeric value ever arrives', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [['not-a-number']] }));
    const step = createStep({
      query: 'q',
      operator: 'lt',
      threshold: '5',
      interval_seconds: 0.05,
      timeout_seconds: 0.15,
    });

    await expect(step.executeAsync()).rejects.toThrow(/never returned a numeric value/);
  });

  it('includes the last observed value in the timeout error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [[10]] }));
    const step = createStep({
      query: 'q',
      operator: 'lt',
      threshold: '5',
      interval_seconds: 0.05,
      timeout_seconds: 0.15,
    });

    await expect(step.executeAsync()).rejects.toThrow(/last value: 10/);
  });

  it('throws on a non-positive interval', async () => {
    const step = createStep({ query: 'q', operator: 'lt', threshold: '5', interval_seconds: 0 });

    await expect(step.executeAsync()).rejects.toThrow(/greater than 0/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['lte', 3, 3],
    ['gt', 10, 5],
    ['gte', 5, 5],
    ['eq', 3, 3],
  ] as const)('clears with the %s operator', async (operator, value, threshold) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [[value]] }));
    const step = createStep({ query: 'q', operator, threshold });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a non-numeric non-string cell as no value and keeps polling', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [[true]] }))
      .mockResolvedValueOnce(jsonResponse({ results: [[1]] }));
    const step = createStep({
      query: 'q',
      operator: 'lt',
      threshold: '5',
      interval_seconds: 0.05,
      timeout_seconds: 5,
    });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries after a network error and clears when the query recovers', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ results: [[1]] }));
    const step = createStep({
      query: 'q',
      operator: 'lt',
      threshold: '5',
      interval_seconds: 0.05,
      timeout_seconds: 5,
    });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnMock).toHaveBeenCalledWith(
      'Running the PostHog query failed with a network error; will retry on the next poll.'
    );
  });

  it('retries after an invalid JSON response and clears when the query recovers', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('unexpected token');
        },
      } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse({ results: [[1]] }));
    const step = createStep({
      query: 'q',
      operator: 'lt',
      threshold: '5',
      interval_seconds: 0.05,
      timeout_seconds: 5,
    });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on a 403 without retrying', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 403 }));
    const step = createStep({ query: 'q', operator: 'lt', threshold: '5' });

    await expect(step.executeAsync()).rejects.toThrow(/forbidden \(403\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps polling through malformed response shapes until a numeric value arrives', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [[Infinity]] }))
      .mockResolvedValueOnce(jsonResponse('not an object'))
      .mockResolvedValueOnce(jsonResponse({ results: [5] }))
      .mockResolvedValueOnce(jsonResponse({ results: [[1]] }));
    const step = createStep({
      query: 'q',
      operator: 'lt',
      threshold: '5',
      interval_seconds: 0.05,
      timeout_seconds: 5,
    });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
