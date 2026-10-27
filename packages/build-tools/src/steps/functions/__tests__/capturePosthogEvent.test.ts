import fetch, { Response } from 'node-fetch';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createCapturePosthogEventFunction } from '../capturePosthogEvent';

jest.mock('@expo/logger');
jest.mock('node-fetch');

describe(createCapturePosthogEventFunction, () => {
  const fetchMock = jest.mocked(fetch);
  const captureEvent = createCapturePosthogEventFunction();

  afterEach(() => {
    jest.resetAllMocks();
  });

  function createStep(
    callInputs: Record<string, unknown>,
    env: Record<string, string>
  ): ReturnType<typeof captureEvent.createBuildStepFromFunctionCall> {
    return captureEvent.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs,
      env,
      id: captureEvent.id,
    });
  }

  it('sends the event to the ingestion endpoint using the env key', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true } as Response);
    const step = createStep(
      { event: 'workflow_finished', distinct_id: 'account-1' },
      {
        EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test',
        EXPO_PUBLIC_POSTHOG_HOST: 'https://us.posthog.com',
      }
    );

    await step.executeAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us.posthog.com/i/v0/e/');
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      api_key: 'phc_test',
      event: 'workflow_finished',
      distinct_id: 'account-1',
    });
    expect(body.properties?.$process_person_profile).toBeUndefined();
  });

  it('sends an anonymous system event when no distinct_id is given', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true } as Response);
    const step = createStep(
      { event: 'workflow_finished' },
      { EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test' }
    );

    await step.executeAsync();

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.distinct_id).toBe('eas-workflow');
    expect(body.properties.$process_person_profile).toBe(false);
  });

  it('skips when no api key is available and ignore_error is set', async () => {
    const step = createStep(
      { event: 'workflow_finished', distinct_id: 'account-1', ignore_error: true },
      {}
    );
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await step.executeAsync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringMatching(/Ignoring error\.$/)
    );
  });

  it('logs and does not throw on a non-2xx response when ignore_error is set', async () => {
    fetchMock.mockResolvedValue({
      status: 400,
      ok: false,
      text: async () => '',
    } as unknown as Response);
    const step = createStep(
      { event: 'workflow_finished', distinct_id: 'account-1', ignore_error: true },
      { EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test' }
    );
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Sending PostHog event "workflow_finished" failed with status 400. Ignoring error.'
    );
  });

  it('does not let properties override the anonymous marker', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true } as Response);
    const step = createStep(
      { event: 'workflow_finished', properties: { $process_person_profile: true, foo: 'bar' } },
      { EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test' }
    );

    await step.executeAsync();

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.properties.$process_person_profile).toBe(false);
    expect(body.properties.foo).toBe('bar');
  });

  it('throws on a network error by default', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const step = createStep(
      { event: 'workflow_finished' },
      { EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test' }
    );

    await expect(step.executeAsync()).rejects.toThrow(
      'Sending PostHog event "workflow_finished" failed.'
    );
  });

  it('logs and does not throw on a network error when ignore_error is set', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const step = createStep(
      { event: 'workflow_finished', ignore_error: true },
      { EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test' }
    );
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Sending PostHog event "workflow_finished" failed. Ignoring error.'
    );
  });

  it('throws with the PostHog error detail on failure by default', async () => {
    fetchMock.mockResolvedValue({
      status: 400,
      ok: false,
      text: async () => JSON.stringify({ detail: 'Invalid event name' }),
    } as unknown as Response);
    const step = createStep(
      { event: 'workflow_finished' },
      { EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test' }
    );

    await expect(step.executeAsync()).rejects.toThrow(/failed with status 400: Invalid event name/);
  });

  it('falls back to the raw error body when PostHog omits a detail', async () => {
    fetchMock.mockResolvedValue({
      status: 400,
      ok: false,
      text: async () => JSON.stringify({ error: 'nope' }),
    } as unknown as Response);
    const step = createStep(
      { event: 'workflow_finished' },
      { EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test' }
    );

    await expect(step.executeAsync()).rejects.toThrow(/failed with status 400: {"error":"nope"}/);
  });

  it('throws on missing key by default', async () => {
    const step = createStep({ event: 'workflow_finished' }, {});

    await expect(step.executeAsync()).rejects.toThrow(/PostHog API key not provided/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
