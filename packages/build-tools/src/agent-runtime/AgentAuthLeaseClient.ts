import { errors } from '@expo/eas-build-job';
import fetch from 'node-fetch';
import { z } from 'zod';

const AgentProviderRuntimeLeaseZ = z.discriminatedUnion('provider', [
  z.strictObject({
    provider: z.literal('anthropic'),
    accessToken: z.string().min(1),
    expiresAt: z.string().datetime(),
  }),
  z.strictObject({
    provider: z.literal('openai'),
    idToken: z.string().min(1),
    accessToken: z.string().min(1),
    accountId: z.string().min(1),
    plan: z.string().nullable(),
    expiresAt: z.string().datetime(),
    accessTokenFingerprint: z.string().length(43),
  }),
]);

const AgentProviderRuntimeLeaseResponseZ = z.strictObject({
  data: AgentProviderRuntimeLeaseZ,
});

export type AgentProviderRuntimeLease = z.infer<typeof AgentProviderRuntimeLeaseZ>;

export type AgentProviderRuntimeLeaseRequest =
  | { reason: 'startup' | 'proactive' }
  | { reason: 'unauthorized'; previousAccessTokenFingerprint: string };

export class AgentAuthLeaseClient {
  private readonly endpoint: string;

  public constructor({
    expoApiV2BaseUrl,
    expoToken,
    jobRunId,
    registerSecret,
  }: {
    expoApiV2BaseUrl: string;
    expoToken: string;
    jobRunId: string;
    registerSecret?: (value: string) => void;
  }) {
    this.endpoint = new URL(
      `agent-job-runs/${jobRunId}/auth-lease`,
      ensureTrailingSlash(expoApiV2BaseUrl)
    ).toString();
    this.expoToken = expoToken;
    this.registerSecret = registerSecret;
  }

  private readonly expoToken: string;
  private readonly registerSecret?: (value: string) => void;

  public async getLeaseAsync(
    request: AgentProviderRuntimeLeaseRequest,
    signal?: AbortSignal
  ): Promise<AgentProviderRuntimeLease> {
    let response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.expoToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      });
    } catch (error) {
      throw new errors.SystemError(
        'EAS could not request provider access for this agent job. Check the worker network connection and try the job again.',
        { cause: error }
      );
    }

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw new errors.UserError(
          'EAS_AGENT_PROVIDER_ACCESS_REJECTED',
          'EAS could not provide provider access for this agent job. The job may have ended, or the provider connection may need to be reconnected. Reconnect the provider if needed, then start a new job.'
        );
      }
      throw new errors.SystemError(
        'EAS could not provide provider access because the API returned a server error. Try the job again. Contact Expo support if the problem continues.',
        { metadata: { status: response.status } }
      );
    }

    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch (error) {
      throw new errors.SystemError(
        'EAS received an invalid provider access response. Try the job again. Contact Expo support if the problem continues.',
        { cause: error, metadata: { status: response.status } }
      );
    }
    const parsedResponse = AgentProviderRuntimeLeaseResponseZ.safeParse(rawResponse);
    if (!parsedResponse.success) {
      throw new errors.SystemError(
        'EAS received an unexpected provider access response. Try the job again. Contact Expo support if the problem continues.',
        { cause: parsedResponse.error, metadata: { status: response.status } }
      );
    }
    const lease = parsedResponse.data.data;
    this.registerSecret?.(lease.accessToken);
    if (lease.provider === 'openai') {
      this.registerSecret?.(lease.idToken);
    }
    return lease;
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
