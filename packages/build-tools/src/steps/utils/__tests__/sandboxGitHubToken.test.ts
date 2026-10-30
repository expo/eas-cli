import { SystemError, UserError } from '@expo/eas-build-job';
import fetch, { type Response } from 'node-fetch';

import { mintSandboxGitHubTokenAsync } from '../sandboxGitHubToken';

jest.mock('node-fetch');

const fetchMock = jest.mocked(fetch);

afterEach(() => {
  jest.useRealTimers();
});

const jobRunId = '0199b0a0-1111-7222-8333-444455556666';
const token = 'ghs_minted_token_value';
const options = {
  expoApiV2BaseUrl: 'https://staging-api.expo.test/v2/',
  robotAccessToken: 'robot-token',
  jobRunId,
};

function createResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) {
        throw new Error('not JSON');
      }
      return body;
    },
  } as unknown as Response;
}

async function captureErrorAsync(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject');
}

describe(mintSandboxGitHubTokenAsync, () => {
  it('mints a token with the job token', async () => {
    fetchMock.mockResolvedValue(createResponse(200, { data: { token } }));

    await expect(mintSandboxGitHubTokenAsync(options)).resolves.toBe(token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://staging-api.expo.test/v2/turtle-job-runs/${jobRunId}/github-token`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer robot-token' },
    });
  });

  it.each([400, 403, 404])(
    'reports HTTP %s with the message from www and does not retry',
    async status => {
      fetchMock.mockResolvedValue(
        createResponse(status, {
          errors: [{ code: 'UNAUTHORIZED', message: 'This job run cannot mint GitHub tokens.' }],
        })
      );

      const error = await captureErrorAsync(mintSandboxGitHubTokenAsync(options));

      expect(error).toBeInstanceOf(UserError);
      expect(error).toMatchObject({
        errorCode: 'EAS_SANDBOX_GITHUB_TOKEN_REJECTED',
        message: 'This job run cannot mint GitHub tokens.',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('reports a 4xx without a readable body', async () => {
    fetchMock.mockResolvedValue(createResponse(403, undefined));

    await expect(mintSandboxGitHubTokenAsync(options)).rejects.toThrow(
      'Expo refused to mint a GitHub token for this sandbox (HTTP 403).'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries server errors and network failures', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(createResponse(503, undefined))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(createResponse(200, { data: { token } }));

    const assertion = expect(mintSandboxGitHubTokenAsync(options)).resolves.toBe(token);
    await jest.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['HTTP 500', () => fetchMock.mockResolvedValue(createResponse(500, undefined))],
    ['a rejected request', () => fetchMock.mockRejectedValue(new Error('socket hang up'))],
  ])('gives up after three attempts of %s', async (_label, arrange) => {
    jest.useFakeTimers();
    arrange();

    const pending = captureErrorAsync(mintSandboxGitHubTokenAsync(options));
    await jest.runAllTimersAsync();
    const error = await pending;

    expect(error).toBeInstanceOf(SystemError);
    expect(error.message).toContain('failed 3 times');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a successful response without a token', async () => {
    fetchMock.mockResolvedValue(createResponse(200, { data: { expiresAt: 'soon' } }));

    await expect(mintSandboxGitHubTokenAsync(options)).rejects.toBeInstanceOf(SystemError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never puts the token into an error message', async () => {
    fetchMock.mockResolvedValue(createResponse(200, { data: { token: 123, hint: token } }));

    const error = await captureErrorAsync(mintSandboxGitHubTokenAsync(options));

    expect(error).toBeInstanceOf(SystemError);
    expect(error.message).not.toContain(token);
    expect(String((error as SystemError).cause)).not.toContain(token);
  });
});
