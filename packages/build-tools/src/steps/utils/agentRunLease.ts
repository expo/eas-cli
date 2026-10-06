import { SystemError, UserError } from '@expo/eas-build-job';
import fetch from 'node-fetch';
import { z } from 'zod';

import { promiseRetryWithCondition } from '../../utils/promiseRetryWithCondition';

const AgentRunProviderCredentialsZ = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('anthropic'),
    accessToken: z.string().min(1),
  }),
  z.object({
    provider: z.literal('openai'),
    idToken: z.string().min(1),
    accessToken: z.string().min(1),
    accountId: z.string().min(1),
  }),
]);
const LeaseResponseZ = z.object({ data: AgentRunProviderCredentialsZ });
const ErrorResponseZ = z.object({
  errors: z.array(z.object({ message: z.string().min(1) })).min(1),
});

export type AgentRunProviderCredentials = z.infer<typeof AgentRunProviderCredentialsZ>;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;

class RetryableLeaseError extends Error {}

export async function leaseAgentRunProviderCredentialsAsync(options: {
  expoApiV2BaseUrl: string;
  expoToken: string;
  agentRunId: string;
  signal?: AbortSignal;
}): Promise<AgentRunProviderCredentials> {
  try {
    return await promiseRetryWithCondition(
      requestLeaseAsync,
      error => error instanceof RetryableLeaseError,
      { retries: MAX_ATTEMPTS - 1, factor: 1, minTimeout: RETRY_DELAY_MS }
    )(options);
  } catch (error) {
    if (error instanceof RetryableLeaseError) {
      throw new SystemError(
        `Could not lease provider credentials for the agent run because the Expo API failed ${MAX_ATTEMPTS} times in a row. This is usually temporary; start the agent run again, and contact Expo support if it keeps failing.`,
        { cause: error.cause ?? error }
      );
    }
    throw error;
  }
}

// Which failures count as retryable follows www's contract for this route.
async function requestLeaseAsync({
  expoApiV2BaseUrl,
  expoToken,
  agentRunId,
  signal,
}: {
  expoApiV2BaseUrl: string;
  expoToken: string;
  agentRunId: string;
  signal?: AbortSignal;
}): Promise<AgentRunProviderCredentials> {
  const url = new URL(`agent-runs/${agentRunId}/auth-lease`, expoApiV2BaseUrl).toString();
  let response;
  let body: unknown;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${expoToken}` },
      timeout: REQUEST_TIMEOUT_MS,
      signal,
    });
    // Reading the body can fail the way the request can, so it is retried with it.
    body = response.ok ? await response.json() : undefined;
  } catch (error) {
    signal?.throwIfAborted();
    throw new RetryableLeaseError('The request to the Expo API failed.', { cause: error });
  }
  if (response.ok) {
    const parsed = LeaseResponseZ.safeParse(body);
    if (!parsed.success) {
      throw new SystemError(
        'The Expo API returned provider credentials in an unexpected format, so the agent cannot run. This is a problem on our side; contact Expo support if it keeps happening.',
        { cause: parsed.error }
      );
    }
    return parsed.data.data;
  }
  if (response.status < 500) {
    const errorBody = ErrorResponseZ.safeParse(await response.json().catch(() => null));
    throw new UserError(
      'EAS_RUN_AGENT_CREDENTIALS_UNAVAILABLE',
      errorBody.success
        ? errorBody.data.errors[0].message
        : `Expo refused to issue provider credentials for this agent run (HTTP ${response.status}). The run may have ended, or its provider connection may have been removed. Start a new agent run.`
    );
  }
  throw new RetryableLeaseError(`The Expo API responded with HTTP ${response.status}.`);
}
