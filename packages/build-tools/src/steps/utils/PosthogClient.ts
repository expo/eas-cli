import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import fetch, { Response } from 'node-fetch';
import { z } from 'zod';

import { PosthogUtils } from './PosthogUtils';

const POSTHOG_DEFAULT_HOST = 'https://us.posthog.com';
const SYSTEM_DISTINCT_ID = 'eas-workflow';

const QueryResponseSchema = z.object({ results: z.array(z.array(z.unknown())) });

interface PosthogCredential {
  label: string;
  envVar: string;
  input: string;
}

const POSTHOG_API_CREDENTIALS = {
  apiKey: { label: 'personal API key', envVar: 'POSTHOG_CLI_API_KEY', input: 'api_key' },
  projectId: { label: 'project id', envVar: 'POSTHOG_CLI_PROJECT_ID', input: 'project_id' },
} satisfies Record<string, PosthogCredential>;

function missingPosthogCredentialsMessage(missing: PosthogCredential[]): string {
  const labels = missing.map(credential => credential.label).join(', ');
  const envVars = missing.map(credential => credential.envVar).join(', ');
  const inputs = missing.map(credential => credential.input).join(', ');
  return `Missing PostHog credentials: ${labels}. Set the environment variables (${envVars}) or step inputs (${inputs}) on EAS, or re-run "eas integrations:posthog:connect" with error tracking enabled.`;
}

export function missingPosthogCredentialsError(missing: PosthogCredential[]): UserError {
  return new UserError(
    'EAS_POSTHOG_MISSING_CREDENTIALS',
    missingPosthogCredentialsMessage(missing)
  );
}

export class PosthogRetryableError extends Error {}

export class PosthogClient {
  private constructor(
    private readonly host: string,
    private readonly apiKey: string,
    private readonly projectId: string
  ) {}

  static fromEnv({
    apiKeyOverride,
    projectIdOverride,
    env,
  }: {
    apiKeyOverride: string | undefined;
    projectIdOverride: string | undefined;
    env: BuildStepEnv;
  }): { client: PosthogClient } | { client: undefined; missing: PosthogCredential[] } {
    const apiKey = apiKeyOverride || env.POSTHOG_CLI_API_KEY;
    const projectId = projectIdOverride || env.POSTHOG_CLI_PROJECT_ID;
    if (!apiKey || !projectId) {
      return {
        client: undefined,
        missing: [
          ...(apiKey ? [] : [POSTHOG_API_CREDENTIALS.apiKey]),
          ...(projectId ? [] : [POSTHOG_API_CREDENTIALS.projectId]),
        ],
      };
    }
    return {
      client: new PosthogClient(
        (env.POSTHOG_CLI_HOST || POSTHOG_DEFAULT_HOST).replace(/\/+$/, ''),
        apiKey,
        projectId
      ),
    };
  }

  static forIngestion({
    apiKeyOverride,
    hostOverride,
    env,
  }: {
    apiKeyOverride: string | undefined;
    hostOverride: string | undefined;
    env: BuildStepEnv;
  }): PosthogClient | undefined {
    const apiKey = apiKeyOverride || env.EXPO_PUBLIC_POSTHOG_API_KEY || env.POSTHOG_API_KEY;
    if (!apiKey) {
      return undefined;
    }
    return new PosthogClient(
      (hostOverride || env.EXPO_PUBLIC_POSTHOG_HOST || POSTHOG_DEFAULT_HOST).replace(/\/+$/, ''),
      apiKey,
      ''
    );
  }

  async captureEventAsync({
    event,
    distinctId,
    properties,
  }: {
    event: string;
    distinctId: string | undefined;
    properties: Record<string, unknown> | undefined;
  }): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.host}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          event,
          distinct_id: distinctId ?? SYSTEM_DISTINCT_ID,
          properties:
            distinctId !== undefined
              ? properties
              : { ...properties, $process_person_profile: false },
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (error) {
      throw new UserError(
        'EAS_POSTHOG_CAPTURE_FAILED',
        `Sending PostHog event "${event}" failed.`,
        {
          cause: error,
        }
      );
    }
    if (!response.ok) {
      throw new UserError(
        'EAS_POSTHOG_CAPTURE_FAILED',
        `Sending PostHog event "${event}" failed with ${await PosthogUtils.readErrorAsync(response)}.`
      );
    }
  }

  async requestAsync(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    { action, forbiddenScope, body }: { action: string; forbiddenScope: string; body?: unknown }
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.apiUrl(path), {
        method,
        headers: this.authHeaders(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new UserError('EAS_POSTHOG_REQUEST_FAILED', `${action} failed.`, { cause: error });
    }
    if (response.status === 403) {
      throw new UserError(
        'EAS_POSTHOG_FORBIDDEN',
        `${action} was forbidden (403). The personal API key likely lacks the "${forbiddenScope}" scope.`
      );
    }
    if (!response.ok) {
      throw new UserError(
        'EAS_POSTHOG_REQUEST_FAILED',
        `${action} failed with ${await PosthogUtils.readErrorAsync(response)}.`
      );
    }
    return response;
  }

  async runQueryAsync(
    query: string,
    logger: bunyan,
    signal: AbortSignal | undefined
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.apiUrl('/query/'), {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, refresh: 'blocking' }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      logger.debug(error);
      logger.warn(
        'Running the PostHog query failed with a network error; will retry on the next poll.'
      );
      throw new PosthogRetryableError();
    }
    if (response.status === 403) {
      throw new UserError(
        'EAS_POSTHOG_FORBIDDEN',
        'Running the PostHog query was forbidden (403). The personal API key likely lacks the "query:read" scope.'
      );
    }
    if (response.status >= 500 || response.status === 429) {
      logger.warn(
        `Running the PostHog query failed with status ${response.status}; will retry on the next poll.`
      );
      throw new PosthogRetryableError();
    }
    if (!response.ok) {
      throw new UserError(
        'EAS_POSTHOG_REQUEST_FAILED',
        `Running the PostHog query failed with ${await PosthogUtils.readErrorAsync(response)}.`
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      logger.debug(error);
      logger.warn('The PostHog query response was not valid JSON; will retry on the next poll.');
      throw new PosthogRetryableError();
    }
    const parsed = QueryResponseSchema.safeParse(body);
    return parsed.success ? parsed.data.results[0]?.[0] : undefined;
  }

  cliConfig(): { host: string; env: Record<string, string> } {
    return {
      host: this.host,
      env: { POSTHOG_CLI_API_KEY: this.apiKey, POSTHOG_CLI_PROJECT_ID: this.projectId },
    };
  }

  private apiUrl(path: string): string {
    return `${this.host}/api/projects/${encodeURIComponent(this.projectId)}${path}`;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }
}
