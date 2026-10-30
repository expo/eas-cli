import { SystemError, UserError } from '@expo/eas-build-job';
import fetch, { type Response } from 'node-fetch';

import { leaseAgentRunProviderCredentialsAsync } from '../agentRunLease';

jest.mock('node-fetch');

const fetchMock = jest.mocked(fetch);

afterEach(() => {
  jest.useRealTimers();
});

const agentRunId = '0199b0a0-1111-7222-8333-444455556666';
const options = {
  expoApiV2BaseUrl: 'https://staging-api.expo.test/v2/',
  expoToken: 'expo-token',
  agentRunId,
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

describe(leaseAgentRunProviderCredentialsAsync, () => {
  it('leases Anthropic credentials with the job token', async () => {
    const lease = { provider: 'anthropic', accessToken: 'access-token' };
    fetchMock.mockResolvedValue(
      createResponse(200, { data: { ...lease, expiresAt: '2026-10-06T12:00:00.000Z' } })
    );

    await expect(leaseAgentRunProviderCredentialsAsync(options)).resolves.toEqual(lease);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://staging-api.expo.test/v2/agent-runs/${agentRunId}/auth-lease`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer expo-token' },
    });
  });

  it('leases OpenAI credentials', async () => {
    const lease = {
      provider: 'openai',
      idToken: 'id-token',
      accessToken: 'access-token',
      accountId: 'account-id',
    };
    fetchMock.mockResolvedValue(createResponse(200, { data: lease }));

    await expect(leaseAgentRunProviderCredentialsAsync(options)).resolves.toEqual(lease);
  });

  it('reports a 4xx with the message from the server and does not retry', async () => {
    fetchMock.mockResolvedValue(
      createResponse(400, {
        errors: [
          {
            code: 'AGENT_RUN_PROVIDER_CONNECTION_DELETED',
            message: 'The provider connection for this agent run was deleted.',
          },
        ],
      })
    );

    const lease = leaseAgentRunProviderCredentialsAsync(options);

    await expect(lease).rejects.toBeInstanceOf(UserError);
    await expect(lease).rejects.toMatchObject({
      errorCode: 'EAS_RUN_AGENT_CREDENTIALS_UNAVAILABLE',
      message: 'The provider connection for this agent run was deleted.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a 4xx without a readable body', async () => {
    fetchMock.mockResolvedValue(createResponse(401, undefined));

    await expect(leaseAgentRunProviderCredentialsAsync(options)).rejects.toThrow(
      'Expo refused to issue provider credentials for this agent run (HTTP 401).'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries server errors and network failures', async () => {
    jest.useFakeTimers();
    const lease = { provider: 'anthropic', accessToken: 'access-token' };
    fetchMock
      .mockResolvedValueOnce(createResponse(503, undefined))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(createResponse(200, { data: lease }));

    const assertion = expect(leaseAgentRunProviderCredentialsAsync(options)).resolves.toEqual(
      lease
    );
    await jest.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries when the body of a successful response cannot be read', async () => {
    jest.useFakeTimers();
    const lease = { provider: 'anthropic', accessToken: 'access-token' };
    fetchMock
      .mockResolvedValueOnce(createResponse(200, undefined))
      .mockResolvedValueOnce(createResponse(200, { data: lease }));

    const assertion = expect(leaseAgentRunProviderCredentialsAsync(options)).resolves.toEqual(
      lease
    );
    await jest.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after three failed attempts', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(createResponse(500, undefined));

    const assertion = expect(leaseAgentRunProviderCredentialsAsync(options)).rejects.toBeInstanceOf(
      SystemError
    );
    await jest.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a successful response that is not a lease', async () => {
    fetchMock.mockResolvedValue(
      createResponse(200, { data: { provider: 'anthropic', refreshToken: 'nope' } })
    );

    await expect(leaseAgentRunProviderCredentialsAsync(options)).rejects.toBeInstanceOf(
      SystemError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
