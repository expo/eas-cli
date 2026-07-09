import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { Response } from 'node-fetch';

export namespace PosthogUtils {
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
