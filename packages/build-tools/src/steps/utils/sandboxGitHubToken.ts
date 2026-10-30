import { SystemError, UserError } from '@expo/eas-build-job';
import fetch from 'node-fetch';
import { z } from 'zod';

import { promiseRetryWithCondition } from '../../utils/promiseRetryWithCondition';

const TokenResponseZ = z.object({ data: z.object({ token: z.string().min(1) }) });
const ErrorResponseZ = z.object({
  errors: z.array(z.object({ message: z.string().min(1) })).min(1),
});

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;

class RetryableTokenError extends Error {}

export async function mintSandboxGitHubTokenAsync(options: {
  expoApiV2BaseUrl: string;
  robotAccessToken: string;
  jobRunId: string;
  signal?: AbortSignal;
}): Promise<string> {
  try {
    return await promiseRetryWithCondition(
      requestTokenAsync,
      error => error instanceof RetryableTokenError,
      { retries: MAX_ATTEMPTS - 1, factor: 1, minTimeout: RETRY_DELAY_MS }
    )(options);
  } catch (error) {
    if (error instanceof RetryableTokenError) {
      throw new SystemError(
        `Could not mint a GitHub token for the sandbox because the Expo API failed ${MAX_ATTEMPTS} times in a row. This is usually temporary; retry the git operation, and contact Expo support if it keeps failing.`,
        { cause: error.cause ?? error }
      );
    }
    throw error;
  }
}

async function requestTokenAsync({
  expoApiV2BaseUrl,
  robotAccessToken,
  jobRunId,
  signal,
}: {
  expoApiV2BaseUrl: string;
  robotAccessToken: string;
  jobRunId: string;
  signal?: AbortSignal;
}): Promise<string> {
  const url = new URL(`turtle-job-runs/${jobRunId}/github-token`, expoApiV2BaseUrl).toString();
  let response;
  let body: unknown;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${robotAccessToken}` },
      timeout: REQUEST_TIMEOUT_MS,
      signal,
    });
    body = response.ok ? await response.json() : undefined;
  } catch (error) {
    signal?.throwIfAborted();
    throw new RetryableTokenError('The request to the Expo API failed.', { cause: error });
  }
  if (response.ok) {
    const parsed = TokenResponseZ.safeParse(body);
    if (!parsed.success) {
      throw new SystemError(
        'The Expo API returned a GitHub token in an unexpected format. This is a problem on our side; contact Expo support if it keeps happening.',
        { cause: parsed.error }
      );
    }
    return parsed.data.data.token;
  }
  if (response.status < 500) {
    const errorBody = ErrorResponseZ.safeParse(await response.json().catch(() => null));
    throw new UserError(
      'EAS_SANDBOX_GITHUB_TOKEN_REJECTED',
      errorBody.success
        ? errorBody.data.errors[0].message
        : `Expo refused to mint a GitHub token for this sandbox (HTTP ${response.status}). The sandbox may have ended, or the project may no longer be linked to a GitHub repository.`
    );
  }
  throw new RetryableTokenError(`The Expo API responded with HTTP ${response.status}.`);
}
