import { type Env, type EnvironmentSecret, type Job, SystemError } from '@expo/eas-build-job';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  type ProjectArchiveSource,
  ProjectArchiveSourceSchema,
} from '../../common/projectArchiveSource';
import { getStringEnvironmentSecretValue } from '../../utils/environmentSecrets';
import { WorkerApi, type WorkerApiRequestOptions, getExpoApiV2BaseUrl } from './workerApi';

export const SANDBOX_WORKER_TOKEN_ENV = 'EAS_SANDBOX_WORKER_TOKEN';

export const SANDBOX_WORKER_TOKEN_HEADER = 'expo-sandbox-worker-token';

const MarkReadyResponseSchema = z.object({ id: z.string() });

const ArtifactUploadSessionSchema = z.object({
  artifact: z.object({ id: z.string() }),
  uploadSession: z.object({
    url: z.string(),
    headers: z.record(z.string(), z.string()),
  }),
});

const FinalizedArtifactSchema = z.object({
  id: z.string(),
  downloadUrl: z.string(),
});

export type SandboxArtifactUploadSession = z.infer<typeof ArtifactUploadSessionSchema>;

export class SandboxWorkerApi {
  private readonly client: WorkerApi;

  constructor(
    expoApiV2BaseUrl: string,
    readonly token: string
  ) {
    this.client = new WorkerApi(new URL('sandbox-worker/', expoApiV2BaseUrl).toString(), {
      authHeader: SANDBOX_WORKER_TOKEN_HEADER,
      token,
    });
  }

  public async getProjectArchiveSourceAsync(
    options: WorkerApiRequestOptions = {}
  ): Promise<ProjectArchiveSource> {
    return await this.client.requestAsync(
      'POST',
      'project-archive',
      ProjectArchiveSourceSchema,
      options
    );
  }

  public async markReadyAsync(options: WorkerApiRequestOptions = {}): Promise<void> {
    await this.client.requestAsync('POST', 'ready', MarkReadyResponseSchema, options);
  }

  public async createArtifactUploadSessionAsync(
    input: { name: string; filename: string; size: number },
    options: WorkerApiRequestOptions = {}
  ): Promise<SandboxArtifactUploadSession> {
    return await this.client.requestAsync(
      'POST',
      'artifact-upload-sessions',
      ArtifactUploadSessionSchema,
      { ...options, json: input, idempotencyKey: randomUUID() }
    );
  }

  public async finalizeArtifactAsync(
    artifactId: string,
    options: WorkerApiRequestOptions = {}
  ): Promise<string> {
    const { downloadUrl } = await this.client.requestAsync(
      'POST',
      `artifacts/${encodeURIComponent(artifactId)}/finalize`,
      FinalizedArtifactSchema,
      options
    );
    return downloadUrl;
  }
}

export function getSandboxWorkerTokenFromEnvironmentSecrets(
  environmentSecrets: EnvironmentSecret[] | undefined
): string | null {
  return getStringEnvironmentSecretValue(environmentSecrets, SANDBOX_WORKER_TOKEN_ENV);
}

export function getSandboxWorkerApi(ctx: {
  job: Job;
  env: Env;
  expoApiV2BaseUrl?: string;
}): SandboxWorkerApi | null {
  const token = getSandboxWorkerTokenFromEnvironmentSecrets(ctx.job.secrets?.environmentSecrets);
  return token ? new SandboxWorkerApi(getExpoApiV2BaseUrl(ctx), token) : null;
}

export function requireSandboxWorkerApi(ctx: {
  job: Job;
  env: Env;
  expoApiV2BaseUrl?: string;
}): SandboxWorkerApi {
  const workerApi = getSandboxWorkerApi(ctx);
  if (!workerApi) {
    throw new SystemError(
      `This sandbox job has no ${SANDBOX_WORKER_TOKEN_ENV} secret. ` +
        'www gives one to every sandbox job, and the worker needs it to call the sandbox API. ' +
        'Start a new sandbox, and contact support if it happens again.'
    );
  }
  return workerApi;
}
