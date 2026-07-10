import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { Response } from 'node-fetch';

export namespace PosthogUtils {
  export const DEFAULT_POLL_TIMEOUT_SECONDS = 600;
  export const DEFAULT_POLL_INTERVAL_SECONDS = 30;

  export function assertPollBoundsPositive({
    timeoutSeconds,
    intervalSeconds,
    errorCode,
  }: {
    timeoutSeconds: number;
    intervalSeconds: number;
    errorCode: string;
  }): void {
    if (timeoutSeconds <= 0 || intervalSeconds <= 0) {
      throw new UserError(
        errorCode,
        '"timeout_seconds" and "interval_seconds" must be greater than 0.'
      );
    }
  }

  export async function waitForNextPollAsync({
    intervalSeconds,
    deadline,
    signal,
  }: {
    intervalSeconds: number;
    deadline: number;
    signal: AbortSignal | undefined;
  }): Promise<boolean> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return false;
    }
    await setTimeoutAsync(Math.min(intervalSeconds * 1000, remainingMs), undefined, { signal });
    return true;
  }

  export function failOrLogError({
    logger,
    ignoreError,
    error,
  }: {
    logger: bunyan;
    ignoreError: boolean;
    error: unknown;
  }): void {
    if (
      !ignoreError ||
      (error instanceof UserError && error.errorCode === 'EAS_POSTHOG_FORBIDDEN')
    ) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: error }, `${message} Ignoring error.`);
  }

  export async function readErrorAsync(response: Response): Promise<string> {
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        const body = JSON.parse(text) as unknown;
        if (typeof body === 'object' && body !== null) {
          const { detail } = body as Record<string, unknown>;
          if (typeof detail === 'string' && detail !== '') {
            return `status ${response.status}: ${detail} (${text})`;
          }
        }
      } catch {
        return `status ${response.status}: ${text}`;
      }
      return `status ${response.status}: ${text}`;
    }
    return `status ${response.status}`;
  }
}
