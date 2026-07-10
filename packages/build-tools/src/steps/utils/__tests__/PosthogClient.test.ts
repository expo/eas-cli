import { UserError } from '@expo/eas-build-job';
import { createLogger } from '@expo/logger';
import fetch, { Response } from 'node-fetch';

import {
  PosthogClient,
  PosthogRetryableError,
  missingPosthogCredentialsError,
} from '../PosthogClient';

jest.mock('@expo/logger');
jest.mock('node-fetch');

const fetchMock = jest.mocked(fetch);
const logger = createLogger({ name: 'test' });

function res({
  ok = true,
  status = 200,
  json,
  text,
}: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}): Response {
  return {
    ok,
    status,
    json: async () => json,
    text: async () => text ?? (json !== undefined ? JSON.stringify(json) : ''),
  } as unknown as Response;
}

const API_ENV = {
  POSTHOG_CLI_API_KEY: 'phx_test',
  POSTHOG_CLI_PROJECT_ID: '123',
  POSTHOG_CLI_HOST: 'https://us.posthog.com',
};

afterEach(() => jest.resetAllMocks());

describe('PosthogClient.fromEnv', () => {
  it('builds a client from env vars', () => {
    expect(
      PosthogClient.fromEnv({
        apiKeyOverride: undefined,
        projectIdOverride: undefined,
        env: API_ENV,
      }).client
    ).toBeInstanceOf(PosthogClient);
  });

  it('prefers overrides over env', async () => {
    fetchMock.mockResolvedValue(res({ json: { results: [[1]] } }));
    const { client } = PosthogClient.fromEnv({
      apiKeyOverride: 'phx_override',
      projectIdOverride: '999',
      env: {},
    });
    await client?.runQueryAsync('select 1', logger, undefined);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us.posthog.com/api/projects/999/query/');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer phx_override');
  });

  it('exposes host and CLI env for subprocess uploads', () => {
    const { client } = PosthogClient.fromEnv({
      apiKeyOverride: 'phx_k',
      projectIdOverride: '55',
      env: { POSTHOG_CLI_HOST: 'https://eu.posthog.com' },
    });
    expect(client?.cliConfig()).toEqual({
      host: 'https://eu.posthog.com',
      env: { POSTHOG_CLI_API_KEY: 'phx_k', POSTHOG_CLI_PROJECT_ID: '55' },
    });
  });

  it('reports both missing credentials when neither is provided', () => {
    const result = PosthogClient.fromEnv({
      apiKeyOverride: undefined,
      projectIdOverride: undefined,
      env: {},
    });
    expect(result.client).toBeUndefined();
    expect(result).toMatchObject({
      missing: [{ label: 'personal API key' }, { label: 'project id' }],
    });
  });

  it('reports only the missing project id when the key is present', () => {
    const result = PosthogClient.fromEnv({
      apiKeyOverride: 'phx',
      projectIdOverride: undefined,
      env: {},
    });
    expect(result.client).toBeUndefined();
    expect(result).toMatchObject({ missing: [{ label: 'project id' }] });
  });

  it('reports only the missing api key when the project id is present', () => {
    const result = PosthogClient.fromEnv({
      apiKeyOverride: undefined,
      projectIdOverride: '1',
      env: {},
    });
    expect(result.client).toBeUndefined();
    expect(result).toMatchObject({ missing: [{ label: 'personal API key' }] });
  });

  it('falls back to the default host', async () => {
    fetchMock.mockResolvedValue(res({ json: { results: [[1]] } }));
    const { client } = PosthogClient.fromEnv({
      apiKeyOverride: 'phx',
      projectIdOverride: '1',
      env: {},
    });
    await client?.runQueryAsync('select 1', logger, undefined);
    expect(fetchMock.mock.calls[0][0]).toBe('https://us.posthog.com/api/projects/1/query/');
  });
});

describe(missingPosthogCredentialsError, () => {
  function missingFrom(
    env: Record<string, string>
  ): Parameters<typeof missingPosthogCredentialsError>[0] {
    const result = PosthogClient.fromEnv({
      apiKeyOverride: undefined,
      projectIdOverride: undefined,
      env,
    });
    return result.client ? [] : result.missing;
  }

  it('names both missing credentials with their env vars and inputs', () => {
    expect(missingPosthogCredentialsError(missingFrom({}))).toMatchObject({
      errorCode: 'EAS_POSTHOG_MISSING_CREDENTIALS',
      message:
        'Missing PostHog credentials: personal API key, project id. Set the environment variables (POSTHOG_CLI_API_KEY, POSTHOG_CLI_PROJECT_ID) or step inputs (api_key, project_id) on EAS, or re-run "eas integrations:posthog:connect" with error tracking enabled.',
    });
  });

  it('names only the missing credential', () => {
    expect(
      missingPosthogCredentialsError(missingFrom({ POSTHOG_CLI_API_KEY: 'phx' })).message
    ).toBe(
      'Missing PostHog credentials: project id. Set the environment variables (POSTHOG_CLI_PROJECT_ID) or step inputs (project_id) on EAS, or re-run "eas integrations:posthog:connect" with error tracking enabled.'
    );
  });
});

describe('PosthogClient.forIngestion', () => {
  it('builds a client and normalizes a trailing-slash host', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, status: 200 }));
    const client = PosthogClient.forIngestion({
      apiKeyOverride: 'phc_x',
      hostOverride: 'https://eu.posthog.com//',
      env: {},
    });
    await client?.captureEventAsync({ event: 'e', distinctId: 'u', properties: undefined });
    expect(fetchMock.mock.calls[0][0]).toBe('https://eu.posthog.com/i/v0/e/');
  });

  it('falls back to a non-public POSTHOG_API_KEY', () => {
    expect(
      PosthogClient.forIngestion({
        apiKeyOverride: undefined,
        hostOverride: undefined,
        env: { POSTHOG_API_KEY: 'phc_secret' },
      })
    ).toBeInstanceOf(PosthogClient);
  });

  it('returns undefined when no key is available', () => {
    expect(
      PosthogClient.forIngestion({ apiKeyOverride: undefined, hostOverride: undefined, env: {} })
    ).toBeUndefined();
  });
});

describe('captureEventAsync', () => {
  const client = PosthogClient.forIngestion({
    apiKeyOverride: 'phc_x',
    hostOverride: undefined,
    env: {},
  });

  it('sends an anonymous system event when no distinct_id is given', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, status: 200 }));
    await client?.captureEventAsync({ event: 'e', distinctId: undefined, properties: { a: 1 } });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.distinct_id).toBe('eas-workflow');
    expect(body.properties).toEqual({ a: 1, $process_person_profile: false });
  });

  it('throws a UserError on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 400, text: 'bad' }));
    await expect(
      client?.captureEventAsync({ event: 'e', distinctId: 'u', properties: undefined })
    ).rejects.toThrow(/failed with status 400: bad/);
  });

  it('throws a UserError on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      client?.captureEventAsync({ event: 'e', distinctId: 'u', properties: undefined })
    ).rejects.toThrow(/Sending PostHog event "e" failed\.$/);
  });
});

describe('requestAsync', () => {
  const { client } = PosthogClient.fromEnv({
    apiKeyOverride: undefined,
    projectIdOverride: undefined,
    env: API_ENV,
  });

  it('sends an authenticated request and returns the response', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, status: 200, json: { id: 1 } }));
    const response = await client?.requestAsync('PATCH', '/feature_flags/1/', {
      action: 'Updating flag',
      forbiddenScope: 'feature_flag:write',
      body: { active: true },
    });
    expect(response?.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us.posthog.com/api/projects/123/feature_flags/1/');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ active: true });
  });

  it('throws a forbidden UserError with the named scope on 403', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 403 }));
    await expect(
      client?.requestAsync('GET', '/feature_flags/', {
        action: 'Looking up flag',
        forbiddenScope: 'feature_flag:read',
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_POSTHOG_FORBIDDEN',
      message: expect.stringContaining('"feature_flag:read"'),
    });
  });

  it('throws with the error detail on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 400, json: { detail: 'nope' } }));
    await expect(
      client?.requestAsync('GET', '/feature_flags/', {
        action: 'Looking up flag',
        forbiddenScope: 'feature_flag:read',
      })
    ).rejects.toThrow(/Looking up flag failed with status 400: nope/);
  });

  it('throws on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      client?.requestAsync('GET', '/feature_flags/', {
        action: 'Looking up flag',
        forbiddenScope: 'feature_flag:read',
      })
    ).rejects.toThrow(/Looking up flag failed\.$/);
  });
});

describe('runQueryAsync', () => {
  const { client } = PosthogClient.fromEnv({
    apiKeyOverride: undefined,
    projectIdOverride: undefined,
    env: API_ENV,
  });

  it('returns the top-left cell', async () => {
    fetchMock.mockResolvedValue(res({ json: { results: [[42]] } }));
    await expect(client?.runQueryAsync('select 1', logger, undefined)).resolves.toBe(42);
  });

  it('throws a retryable error on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(client?.runQueryAsync('q', logger, undefined)).rejects.toBeInstanceOf(
      PosthogRetryableError
    );
  });

  it('passes the signal to fetch and propagates without retrying when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new Error('The operation was aborted'));
    await expect(client?.runQueryAsync('q', logger, controller.signal)).rejects.toThrow(
      'The operation was aborted'
    );
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('throws a retryable error on 5xx and 429', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    await expect(client?.runQueryAsync('q', logger, undefined)).rejects.toBeInstanceOf(
      PosthogRetryableError
    );
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 429 }));
    await expect(client?.runQueryAsync('q', logger, undefined)).rejects.toBeInstanceOf(
      PosthogRetryableError
    );
  });

  it('throws a retryable error on an invalid JSON body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response);
    await expect(client?.runQueryAsync('q', logger, undefined)).rejects.toBeInstanceOf(
      PosthogRetryableError
    );
  });

  it('returns undefined for a malformed result shape', async () => {
    fetchMock.mockResolvedValue(res({ json: { results: 'nope' } }));
    await expect(client?.runQueryAsync('q', logger, undefined)).resolves.toBeUndefined();
  });

  it('throws a forbidden UserError on 403', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 403 }));
    await expect(client?.runQueryAsync('q', logger, undefined)).rejects.toMatchObject({
      errorCode: 'EAS_POSTHOG_FORBIDDEN',
      message: expect.stringContaining('"query:read"'),
    });
  });

  it('throws with the error detail on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 400, text: 'Malformed HogQL' }));
    await expect(client?.runQueryAsync('q', logger, undefined)).rejects.toThrow(
      /failed with status 400: Malformed HogQL/
    );
  });
});

it('is a UserError subclass so the step surfaces it to the user', async () => {
  const { client } = PosthogClient.fromEnv({
    apiKeyOverride: undefined,
    projectIdOverride: undefined,
    env: API_ENV,
  });
  fetchMock.mockResolvedValue(res({ ok: false, status: 403 }));
  await expect(client?.runQueryAsync('q', logger, undefined)).rejects.toBeInstanceOf(UserError);
});
