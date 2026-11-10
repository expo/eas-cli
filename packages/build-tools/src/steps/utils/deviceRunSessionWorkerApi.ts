import { type EnvironmentSecret, SystemError } from '@expo/eas-build-job';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { getStringEnvironmentSecretValue } from '../../utils/environmentSecrets';
import { WorkerApi, type WorkerApiRequestOptions, getExpoApiV2BaseUrl } from './workerApi';

/**
 * The environment secret that holds the device run session token. www gives it only to the job of
 * one device run session, and the token names that session.
 */
export const DEVICE_RUN_SESSION_TOKEN_ENV = 'EAS_DEVICE_RUN_SESSION_TOKEN';

/**
 * www reads the device run session token only from this header, and only on the
 * `/v2/device-run-session-worker/*` routes. It is not an `Authorization` credential.
 */
export const DEVICE_RUN_SESSION_TOKEN_HEADER = 'expo-device-run-session-token';

const DeviceRunSessionStatusSchema = z.object({
  id: z.string(),
  // The status entity values that www returns.
  status: z.enum(['new', 'queued', 'starting', 'in-progress', 'stopped', 'errored']),
});

const UploadSessionSchema = z.object({
  uploadSession: z.object({
    url: z.string(),
    headers: z.record(z.string(), z.string()),
  }),
});

const TurnIceServersSchema = z.object({
  iceServers: z.array(
    z.object({
      urls: z.array(z.string()),
      username: z.string().optional(),
      credential: z.string().optional(),
    })
  ),
});

const DeviceRunSessionApplicationSchema = z.object({
  build: z
    .object({
      id: z.string(),
      gitCommitHash: z.string().nullable(),
      applicationArchiveUrl: z.string().nullable(),
    })
    .nullable(),
});

export type DeviceRunSessionStatus = z.infer<typeof DeviceRunSessionStatusSchema>;
export type DeviceRunSessionUploadSession = z.infer<typeof UploadSessionSchema>['uploadSession'];
export type DeviceRunSessionTurnIceServers = z.infer<typeof TurnIceServersSchema>['iceServers'];
export type DeviceRunSessionApplication = z.infer<typeof DeviceRunSessionApplicationSchema>;

export type CreateDeviceRunSessionArtifactUploadSessionInput = {
  name: string;
  filename: string;
  kind?: string | null;
  size: number;
  metadata?: Record<string, unknown> | null;
};

/**
 * Client for the www routes under `/v2/device-run-session-worker/`. These routes act only on the
 * session that the token names.
 */
export class DeviceRunSessionWorkerApi {
  private readonly client: WorkerApi;

  constructor(expoApiV2BaseUrl: string, token: string) {
    this.client = new WorkerApi(
      new URL('device-run-session-worker/', expoApiV2BaseUrl).toString(),
      {
        authHeader: DEVICE_RUN_SESSION_TOKEN_HEADER,
        token,
      }
    );
  }

  public async getSessionAsync(
    options: WorkerApiRequestOptions = {}
  ): Promise<DeviceRunSessionStatus> {
    return await this.client.requestAsync('GET', 'session', DeviceRunSessionStatusSchema, options);
  }

  public async startAsync(
    { remoteConfig }: { remoteConfig: Record<string, unknown> },
    options: WorkerApiRequestOptions = {}
  ): Promise<DeviceRunSessionStatus> {
    return await this.client.requestAsync('POST', 'start', DeviceRunSessionStatusSchema, {
      ...options,
      json: { remoteConfig },
    });
  }

  public async stopAsync(options: WorkerApiRequestOptions = {}): Promise<DeviceRunSessionStatus> {
    return await this.client.requestAsync('POST', 'stop', DeviceRunSessionStatusSchema, options);
  }

  public async createArtifactUploadSessionAsync(
    input: CreateDeviceRunSessionArtifactUploadSessionInput,
    options: WorkerApiRequestOptions = {}
  ): Promise<DeviceRunSessionUploadSession> {
    const { uploadSession } = await this.client.requestAsync(
      'POST',
      'artifact-upload-sessions',
      UploadSessionSchema,
      { ...options, json: input }
    );
    return uploadSession;
  }

  public async createEventLogUploadSessionAsync(
    options: WorkerApiRequestOptions = {}
  ): Promise<DeviceRunSessionUploadSession> {
    const { uploadSession } = await this.client.requestAsync(
      'POST',
      'event-log-upload-session',
      UploadSessionSchema,
      options
    );
    return uploadSession;
  }

  public async createPreviewUploadSessionAsync(
    options: WorkerApiRequestOptions = {}
  ): Promise<DeviceRunSessionUploadSession> {
    const { uploadSession } = await this.client.requestAsync(
      'POST',
      'preview-upload-session',
      UploadSessionSchema,
      options
    );
    return uploadSession;
  }

  public async fetchTurnIceServersAsync(
    options: WorkerApiRequestOptions = {}
  ): Promise<DeviceRunSessionTurnIceServers> {
    const { iceServers } = await this.client.requestAsync(
      'POST',
      'turn-ice-servers',
      TurnIceServersSchema,
      options
    );
    return iceServers;
  }

  public async getApplicationAsync(
    options: WorkerApiRequestOptions = {}
  ): Promise<DeviceRunSessionApplication> {
    return await this.client.requestAsync(
      'GET',
      'application',
      DeviceRunSessionApplicationSchema,
      options
    );
  }
}

/**
 * Returns a client for the device run session worker API when this job has a device run session
 * token, or null when it does not. Without a token, callers keep using the robot access token and
 * the account-wide API.
 */
export function getDeviceRunSessionWorkerApi(
  ctx: Pick<CustomBuildContext, 'env' | 'expoApiV2BaseUrl'>
): DeviceRunSessionWorkerApi | null {
  const token = ctx.env?.[DEVICE_RUN_SESSION_TOKEN_ENV];
  if (!token) {
    return null;
  }
  return new DeviceRunSessionWorkerApi(getExpoApiV2BaseUrl(ctx), token);
}

/**
 * Returns the client for the device run session worker API, which every device run session job
 * uses to call www about its session.
 */
export function requireDeviceRunSessionWorkerApi(
  ctx: Pick<CustomBuildContext, 'env' | 'expoApiV2BaseUrl'>
): DeviceRunSessionWorkerApi {
  const workerApi = getDeviceRunSessionWorkerApi(ctx);
  if (!workerApi) {
    throw new SystemError(
      `This device run session job has no ${DEVICE_RUN_SESSION_TOKEN_ENV} secret. ` +
        'www gives one to every device run session job, and the worker needs it to call the ' +
        'device run session API. Start a new session, and contact support if it happens again.'
    );
  }
  return workerApi;
}

/**
 * Returns the device run session token from the job's environment secrets, or null. It resolves
 * duplicate names like the build context env does (the last secret wins), so the worker and the
 * steps use the same token. A file secret is not a token.
 */
export function getDeviceRunSessionTokenFromEnvironmentSecrets(
  environmentSecrets: EnvironmentSecret[] | undefined
): string | null {
  return getStringEnvironmentSecretValue(environmentSecrets, DEVICE_RUN_SESSION_TOKEN_ENV);
}
