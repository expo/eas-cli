import fetch, { Response } from 'node-fetch';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createRolloutPosthogFlagFunction } from '../rolloutPosthogFlag';

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

describe(createRolloutPosthogFlagFunction, () => {
  const fetchMock = jest.mocked(fetch);
  const rolloutFlag = createRolloutPosthogFlagFunction();

  afterEach(() => {
    jest.resetAllMocks();
  });

  function createStep(
    callInputs: Record<string, unknown>,
    env: Record<string, string> = ENV
  ): ReturnType<typeof rolloutFlag.createBuildStepFromFunctionCall> {
    return rolloutFlag.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs,
      env,
      id: rolloutFlag.id,
    });
  }

  it('enables a flag by key', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 42 }));
    const step = createStep({ flag: 'my-flag', active: 'true' });

    await step.executeAsync();

    const [patchUrl, patchInit] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe('https://us.posthog.com/api/projects/123/feature_flags/42/');
    expect(patchInit?.method).toBe('PATCH');
    expect(JSON.parse(patchInit?.body as string)).toEqual({ active: true });
  });

  it('sets rollout_percentage only on the catch-all group, preserving others', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: 7,
              key: 'gradual',
              filters: {
                groups: [
                  { properties: [{ key: 'is_internal' }], rollout_percentage: 100 },
                  { properties: [], rollout_percentage: 5 },
                ],
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 7 }));
    const step = createStep({ flag: 'gradual', rollout_percentage: '50' });

    await step.executeAsync();

    const patchBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(patchBody.filters.groups).toEqual([
      { properties: [{ key: 'is_internal' }], rollout_percentage: 100 },
      { properties: [], rollout_percentage: 50 },
    ]);
  });

  it('creates a catch-all group when the flag has none', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 8, key: 'bare', filters: {} }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 8 }));
    const step = createStep({ flag: 'bare', rollout_percentage: '25' });

    await step.executeAsync();

    const patchBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(patchBody.filters.groups).toEqual([{ properties: [], rollout_percentage: 25 }]);
  });

  it('falls back to the first group with a warning when no catch-all exists', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: 9,
              key: 'scoped',
              filters: { groups: [{ properties: [{ key: 'is_internal' }] }] },
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 9 }));
    const step = createStep({ flag: 'scoped', rollout_percentage: '10' });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await step.executeAsync();

    const patchBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(patchBody.filters.groups).toEqual([
      { properties: [{ key: 'is_internal' }], rollout_percentage: 10 },
    ]);
    expect(warnMock).toHaveBeenCalledWith(expect.stringMatching(/no catch-all/));
  });

  it('throws when the flag key does not exist', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ id: 1, key: 'other-flag' }] }));
    const step = createStep({ flag: 'missing-flag', active: 'true' });

    await expect(step.executeAsync()).rejects.toThrow(
      /No PostHog feature flag with key "missing-flag"/
    );
  });

  it('throws on a 403 even when ignore_error is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 403 }));
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });

    await expect(step.executeAsync()).rejects.toThrow(/forbidden \(403\)/);
  });

  it('throws when none of active, rollout_percentage, or payload is provided', async () => {
    const step = createStep({ flag: 'my-flag' });

    await expect(step.executeAsync()).rejects.toThrow(
      /"active", "rollout_percentage", or "payload"/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sets a boolean-flag payload under the "true" key as a JSON string', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 42 }));
    const step = createStep({ flag: 'my-flag', payload: { color: 'blue', count: 3 } });

    await step.executeAsync();

    const patchBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(patchBody.filters.payloads).toEqual({ true: '{"color":"blue","count":3}' });
  });

  it('keys the payload under a given variant', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 42 }));
    const step = createStep({ flag: 'my-flag', payload: { v: 1 }, variant: 'control' });

    await step.executeAsync();

    const patchBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(patchBody.filters.payloads).toEqual({ control: '{"v":1}' });
  });

  it('sets rollout_percentage and payload together in one filters object', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 7, key: 'my-flag', filters: { groups: [{ properties: [] }] } }],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 7 }));
    const step = createStep({ flag: 'my-flag', rollout_percentage: 25, payload: { a: 1 } });

    await step.executeAsync();

    const patchBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(patchBody.filters.groups[0].rollout_percentage).toBe(25);
    expect(patchBody.filters.payloads).toEqual({ true: '{"a":1}' });
  });

  it('surfaces the PostHog error detail on a failed update', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce(
        jsonResponse(
          { type: 'validation_error', detail: 'Variant control does not exist' },
          { ok: false, status: 400 }
        )
      );
    const step = createStep({ flag: 'my-flag', active: 'true' });

    await expect(step.executeAsync()).rejects.toThrow(
      /failed with status 400: Variant control does not exist/
    );
  });

  it('falls back to the raw body when the error body is not JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      } as unknown as Response);
    const step = createStep({ flag: 'my-flag', active: 'true' });

    await expect(step.executeAsync()).rejects.toThrow(/failed with status 502: Bad Gateway/);
  });

  it('warns and skips when the flag is not found and ignore_error is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const step = createStep({ flag: 'missing-flag', active: 'true', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringMatching(/No PostHog feature flag with key "missing-flag"/)
    );
  });

  it('throws on an out-of-range rollout_percentage', async () => {
    const step = createStep({ flag: 'my-flag', rollout_percentage: '150' });

    await expect(step.executeAsync()).rejects.toThrow(/between 0 and 100/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when credentials are missing by default', async () => {
    const step = createStep({ flag: 'my-flag', active: 'true' }, {});

    await expect(step.executeAsync()).rejects.toThrow(
      /Missing PostHog credentials: personal API key, project id/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns and skips on missing credentials when ignore_error is set', async () => {
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true }, {});
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await step.executeAsync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringMatching(/Ignoring error\.$/)
    );
  });

  it('throws on a failed update by default', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
    const step = createStep({ flag: 'my-flag', active: 'true' });

    await expect(step.executeAsync()).rejects.toThrow(/failed with status 500/);
  });

  it('warns and skips on a failed update when ignore_error is set', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Updating PostHog flag "my-flag" failed with status 500: {}. Ignoring error.'
    );
  });

  it('warns and skips on a lookup network error when ignore_error is set', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Looking up PostHog flag "my-flag" failed. Ignoring error.'
    );
  });

  it('warns and skips on a non-object lookup response when ignore_error is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('not-json-object'));
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await step.executeAsync();

    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.anything() },
      expect.stringMatching(/unexpected response/)
    );
  });

  it('warns and skips on an unexpected lookup response when ignore_error is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ nope: true }));
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await step.executeAsync();

    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.anything() },
      expect.stringMatching(/unexpected response/)
    );
  });

  it('ignores malformed entries in the lookup results', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ results: ['junk', null, { id: 42, key: 'my-flag', filters: {} }] })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 42 }));
    const step = createStep({ flag: 'my-flag', active: 'true' });

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on a failed lookup by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
    const step = createStep({ flag: 'my-flag', active: 'true' });

    await expect(step.executeAsync()).rejects.toThrow(
      /Looking up PostHog flag "my-flag" failed with status 500/
    );
  });

  it('warns and skips on a failed lookup when ignore_error is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Looking up PostHog flag "my-flag" failed with status 500: {}. Ignoring error.'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('warns and skips on an update network error when ignore_error is set', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Updating PostHog flag "my-flag" failed. Ignoring error.'
    );
  });

  it('throws on a 403 update even when ignore_error is set', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 403 }));
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });

    await expect(step.executeAsync()).rejects.toThrow(/feature_flag:write/);
  });

  it('debugs the underlying error before throwing on a network failure by default', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const step = createStep({ flag: 'my-flag', active: 'true' });
    const debugMock = jest.spyOn(step.ctx.logger, 'debug');

    await expect(step.executeAsync()).rejects.toThrow(/Looking up PostHog flag "my-flag" failed/);
    expect(debugMock).toHaveBeenCalled();
  });

  it('throws on an invalid JSON lookup response by default', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('unexpected token');
      },
    } as unknown as Response);
    const step = createStep({ flag: 'my-flag', active: 'true' });

    await expect(step.executeAsync()).rejects.toThrow(/returned an unexpected response/);
  });

  it('warns and skips on an invalid JSON lookup response when ignore_error is set', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('unexpected token');
      },
    } as unknown as Response);
    const step = createStep({ flag: 'my-flag', active: 'true', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'PostHog flag lookup for "my-flag" returned an unexpected response. Ignoring error.'
    );
  });

  it('throws on a non-integer rollout_percentage', async () => {
    const step = createStep({ flag: 'my-flag', rollout_percentage: 25.5 });

    await expect(step.executeAsync()).rejects.toThrow(/must be an integer between 0 and 100/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the default host when POSTHOG_CLI_HOST is unset', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 42, key: 'my-flag', filters: {} }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 42 }));
    const step = createStep(
      { flag: 'my-flag', active: 'true' },
      { POSTHOG_CLI_API_KEY: 'phx_test', POSTHOG_CLI_PROJECT_ID: '123' }
    );

    await step.executeAsync();

    const [searchUrl] = fetchMock.mock.calls[0];
    expect(searchUrl).toBe(
      'https://us.posthog.com/api/projects/123/feature_flags/?limit=200&search=my-flag'
    );
  });
});
