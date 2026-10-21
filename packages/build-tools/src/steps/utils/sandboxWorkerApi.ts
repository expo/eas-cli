import { type EnvironmentSecret, EnvironmentSecretType, SystemError } from '@expo/eas-build-job';
import { z } from 'zod';
import type { CustomBuildContext } from '../../customBuildContext';
import { turtleFetch } from '../../utils/turtleFetch';

export const SANDBOX_WORKER_TOKEN_ENV = 'EAS_SANDBOX_WORKER_TOKEN';
export const SANDBOX_WORKER_TOKEN_HEADER = 'expo-sandbox-worker-token';

export class SandboxWorkerApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined
  ) {
    super(message);
    this.name = 'SandboxWorkerApiError';
  }
}

export function getSandboxWorkerTokenFromEnvironmentSecrets(
  secrets: EnvironmentSecret[] | undefined
): string | null {
  const secret = [...(secrets ?? [])]
    .reverse()
    .find(({ name }) => name === SANDBOX_WORKER_TOKEN_ENV);
  return secret?.type === EnvironmentSecretType.STRING && secret.value ? secret.value : null;
}

export function getSandboxWorkerApi(
  ctx: Pick<CustomBuildContext, 'job' | 'expoApiV2BaseUrl' | 'env'>
): SandboxWorkerApi | null {
  const token = getSandboxWorkerTokenFromEnvironmentSecrets(ctx.job.secrets?.environmentSecrets);
  if (!token) {
    return null;
  }
  const baseUrl =
    ctx.expoApiV2BaseUrl ??
    (ctx.env.__API_SERVER_URL ? new URL('/v2/', ctx.env.__API_SERVER_URL).toString() : null);
  if (!baseUrl) {
    throw new SystemError(
      'The sandbox worker API URL is missing. Check the worker configuration and start a new sandbox.'
    );
  }
  return new SandboxWorkerApi(baseUrl, token);
}

export class SandboxWorkerApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async markReadyAsync(signal?: AbortSignal): Promise<void> {
    await this.requestAsync('ready', z.object({ id: z.uuid() }), undefined, signal);
  }

  async createArtifactUploadSessionAsync(
    input: { name: string; filename: string; size: number },
    signal: AbortSignal
  ) {
    return await this.requestAsync(
      'artifact-upload-sessions',
      z.object({
        artifact: z.object({ id: z.uuid() }),
        uploadSession: z.object({
          url: z.string().url(),
          headers: z.record(z.string(), z.string()),
        }),
      }),
      input,
      signal
    );
  }

  async finalizeArtifactAsync(artifactId: string, signal: AbortSignal): Promise<string> {
    const result = await this.requestAsync(
      `artifacts/${encodeURIComponent(artifactId)}/finalize`,
      z.object({ id: z.uuid(), downloadUrl: z.string().url() }),
      undefined,
      signal
    );
    return result.downloadUrl;
  }

  private async requestAsync<T>(
    route: string,
    schema: z.ZodType<T>,
    json?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<T> {
    let response;
    try {
      response = await turtleFetch(
        new URL(`sandbox-worker/${route}`, this.baseUrl).toString(),
        'POST',
        {
          headers: { [SANDBOX_WORKER_TOKEN_HEADER]: this.token },
          json,
          signal,
          timeout: 15_000,
          retries: 0,
          shouldThrowOnNotOk: false,
        }
      );
    } catch {
      signal?.throwIfAborted();
      throw new SandboxWorkerApiError(
        `Sandbox request ${route} failed before www responded. Check the worker connection.`,
        undefined
      );
    }
    signal?.throwIfAborted();
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z
        .object({ errors: z.array(z.object({ message: z.string() })) })
        .safeParse(body);
      throw new SandboxWorkerApiError(
        error.success
          ? error.data.errors.map(e => e.message).join(' ')
          : `Sandbox request ${route} failed (${response.status}). Retry only if its outcome is known.`,
        response.status
      );
    }
    const result = z.object({ data: schema }).safeParse(body);
    if (!result.success) {
      throw new SandboxWorkerApiError(
        `Sandbox request ${route} returned an invalid response. Check the API and worker versions.`,
        response.status
      );
    }
    return result.data.data;
  }
}
