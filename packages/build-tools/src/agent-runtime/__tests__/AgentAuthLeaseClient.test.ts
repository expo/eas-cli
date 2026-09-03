import { errors } from '@expo/eas-build-job';
import fetch from 'node-fetch';

import { AgentAuthLeaseClient } from '../AgentAuthLeaseClient';

describe(AgentAuthLeaseClient, () => {
  afterEach(() => {
    jest.mocked(fetch).mockReset();
  });

  it('requests and parses an access-only OpenAI lease', async () => {
    const lease = {
      provider: 'openai',
      idToken: 'id-token',
      accessToken: 'access-token',
      accountId: 'account-id',
      plan: 'pro',
      expiresAt: '2026-09-02T12:00:00.000Z',
      accessTokenFingerprint: 'f'.repeat(43),
    };
    jest.mocked(fetch).mockResolvedValue(response({ data: lease }));
    const registerSecret = jest.fn();
    const client = new AgentAuthLeaseClient({
      expoApiV2BaseUrl: 'https://api.expo.dev/v2/',
      expoToken: 'expo-token',
      jobRunId: 'job-run-id',
      registerSecret,
    });

    await expect(client.getLeaseAsync({ reason: 'startup' })).resolves.toEqual(lease);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.expo.dev/v2/agent-job-runs/job-run-id/auth-lease',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer expo-token' }),
        body: JSON.stringify({ reason: 'startup' }),
      })
    );
    expect(registerSecret).toHaveBeenCalledWith('access-token');
    expect(registerSecret).toHaveBeenCalledWith('id-token');
  });

  it('requests an unauthorized refresh with only the access-token fingerprint', async () => {
    const fingerprint = 'f'.repeat(43);
    jest.mocked(fetch).mockResolvedValue(
      response({
        data: {
          provider: 'openai',
          idToken: 'new-id-token',
          accessToken: 'new-access-token',
          accountId: 'account-id',
          plan: null,
          expiresAt: '2026-09-02T12:00:00.000Z',
          accessTokenFingerprint: 'n'.repeat(43),
        },
      })
    );
    const client = new AgentAuthLeaseClient({
      expoApiV2BaseUrl: 'https://api.expo.dev/v2',
      expoToken: 'expo-token',
      jobRunId: 'job-run-id',
    });

    await client.getLeaseAsync({
      reason: 'unauthorized',
      previousAccessTokenFingerprint: fingerprint,
    });

    expect(jest.mocked(fetch).mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        reason: 'unauthorized',
        previousAccessTokenFingerprint: fingerprint,
      })
    );
  });

  it('does not include an API response body in a rejected lease error', async () => {
    jest.mocked(fetch).mockResolvedValue(response({ error: 'secret-access-token' }, 403));
    const client = new AgentAuthLeaseClient({
      expoApiV2BaseUrl: 'https://api.expo.dev/v2/',
      expoToken: 'expo-token',
      jobRunId: 'job-run-id',
    });

    const error = await client.getLeaseAsync({ reason: 'startup' }).catch(caughtError => {
      return caughtError;
    });

    expect(error).toBeInstanceOf(errors.UserError);
    expect(String(error)).not.toContain('secret-access-token');
  });

  it('rejects a response that contains a refresh token', async () => {
    jest.mocked(fetch).mockResolvedValue(
      response({
        data: {
          provider: 'anthropic',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: '2026-09-02T12:00:00.000Z',
        },
      })
    );
    const client = new AgentAuthLeaseClient({
      expoApiV2BaseUrl: 'https://api.expo.dev/v2/',
      expoToken: 'expo-token',
      jobRunId: 'job-run-id',
    });

    await expect(client.getLeaseAsync({ reason: 'startup' })).rejects.toBeInstanceOf(
      errors.SystemError
    );
  });
});

function response(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
