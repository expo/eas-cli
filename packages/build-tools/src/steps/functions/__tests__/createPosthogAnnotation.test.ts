import fetch, { Response } from 'node-fetch';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createPosthogAnnotationFunction } from '../createPosthogAnnotation';

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

describe(createPosthogAnnotationFunction, () => {
  const fetchMock = jest.mocked(fetch);
  const annotation = createPosthogAnnotationFunction();

  afterEach(() => {
    jest.resetAllMocks();
  });

  function createStep(
    callInputs: Record<string, unknown>,
    env: Record<string, string> = ENV
  ): ReturnType<typeof annotation.createBuildStepFromFunctionCall> {
    return annotation.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs,
      env,
      id: annotation.id,
    });
  }

  it('posts the annotation with an explicit date_marker', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }, { status: 201 }));
    const step = createStep({ content: 'Released abc123', date_marker: '2026-07-03T00:00:00Z' });

    await step.executeAsync();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us.posthog.com/api/projects/123/annotations/');
    expect(JSON.parse(init?.body as string)).toEqual({
      content: 'Released abc123',
      date_marker: '2026-07-03T00:00:00Z',
    });
  });

  it('defaults date_marker to now when not given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }, { status: 201 }));
    const step = createStep({ content: 'Deploy' });

    await step.executeAsync();

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.content).toBe('Deploy');
    expect(typeof body.date_marker).toBe('string');
  });

  it('throws when credentials are missing by default', async () => {
    const step = createStep({ content: 'Deploy' }, {});

    await expect(step.executeAsync()).rejects.toThrow(/personal API key or project id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns and skips when credentials are missing and ignore_error is set', async () => {
    const step = createStep({ content: 'Deploy', ignore_error: true }, {});
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await step.executeAsync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringMatching(/Ignoring error/)
    );
  });

  it('throws on a network error by default', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const step = createStep({ content: 'Deploy' });

    await expect(step.executeAsync()).rejects.toThrow(/Creating the PostHog annotation failed/);
  });

  it('warns and continues on a network error when ignore_error is set', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const step = createStep({ content: 'Deploy', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringMatching(/Ignoring error/)
    );
  });

  it('throws on a 403 without swallowing it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 403 }));
    const step = createStep({ content: 'Deploy' });

    await expect(step.executeAsync()).rejects.toThrow(/annotation:write/);
  });

  it('throws with the PostHog error detail on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'Invalid date_marker' }, { ok: false, status: 400 })
    );
    const step = createStep({ content: 'Deploy' });

    await expect(step.executeAsync()).rejects.toThrow(
      /failed with status 400: Invalid date_marker/
    );
  });

  it('warns and continues on a non-2xx response when ignore_error is set', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
    const step = createStep({ content: 'Deploy', ignore_error: true });
    const warnMock = jest.spyOn(step.ctx.logger, 'warn');

    await expect(step.executeAsync()).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringMatching(/Ignoring error/)
    );
  });
});
