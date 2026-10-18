import { type EnvironmentSecret, EnvironmentSecretType, SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { FetchError } from 'node-fetch';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { promiseRetryWithCondition } from '../../utils/promiseRetryWithCondition';
import { turtleFetch } from '../../utils/turtleFetch';

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

const DEVICE_RUN_SESSION_WORKER_PATH = 'device-run-session-worker/';

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

const ApiV2ErrorResponseSchema = z.object({
  errors: z.array(z.object({ code: z.string().optional(), message: z.string() })).min(1),
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

type RequestOptions = {
  /** Stops the request when aborted. */
  signal?: AbortSignal;
  /** node-fetch timeout of each attempt, in milliseconds. */
  timeoutMs?: number;
  /** Additional attempts for transient failures. Defaults to none; critical callers opt in. */
  retries?: number;
  logger?: bunyan;
};

/**
 * A request to the device run session worker API failed. The message names the route and the
 * reason. It never includes the device run session token.
 */
export class DeviceRunSessionWorkerApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status of the response, or undefined when no response arrived. */
    readonly status: number | undefined,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'DeviceRunSessionWorkerApiError';
  }

  get isTransient(): boolean {
    return this.status === undefined || this.status >= 500;
  }
}

/**
 * Client for the www routes under `/v2/device-run-session-worker/`. These routes act only on the
 * session that the token names, so no request carries a session ID.
 */
export class DeviceRunSessionWorkerApi {
  constructor(
    private readonly expoApiV2BaseUrl: string,
    private readonly deviceRunSessionToken: string
  ) {}

  public async getSessionAsync(options: RequestOptions = {}): Promise<DeviceRunSessionStatus> {
    return await this.requestAsync('GET', 'session', DeviceRunSessionStatusSchema, options);
  }

  public async startAsync(
    { remoteConfig }: { remoteConfig: Record<string, unknown> },
    options: RequestOptions = {}
  ): Promise<DeviceRunSessionStatus> {
    return await this.requestAsync('POST', 'start', DeviceRunSessionStatusSchema, {
      ...options,
      json: { remoteConfig },
    });
  }

  public async stopAsync(options: RequestOptions = {}): Promise<DeviceRunSessionStatus> {
    return await this.requestAsync('POST', 'stop', DeviceRunSessionStatusSchema, options);
  }

  public async createArtifactUploadSessionAsync(
    input: CreateDeviceRunSessionArtifactUploadSessionInput,
    options: RequestOptions = {}
  ): Promise<DeviceRunSessionUploadSession> {
    const { uploadSession } = await this.requestAsync(
      'POST',
      'artifact-upload-sessions',
      UploadSessionSchema,
      { ...options, json: input }
    );
    return uploadSession;
  }

  public async createEventLogUploadSessionAsync(
    options: RequestOptions = {}
  ): Promise<DeviceRunSessionUploadSession> {
    const { uploadSession } = await this.requestAsync(
      'POST',
      'event-log-upload-session',
      UploadSessionSchema,
      options
    );
    return uploadSession;
  }

  public async createPreviewUploadSessionAsync(
    options: RequestOptions = {}
  ): Promise<DeviceRunSessionUploadSession> {
    const { uploadSession } = await this.requestAsync(
      'POST',
      'preview-upload-session',
      UploadSessionSchema,
      options
    );
    return uploadSession;
  }

  public async fetchTurnIceServersAsync(
    options: RequestOptions = {}
  ): Promise<DeviceRunSessionTurnIceServers> {
    const { iceServers } = await this.requestAsync(
      'POST',
      'turn-ice-servers',
      TurnIceServersSchema,
      options
    );
    return iceServers;
  }

  public async getApplicationAsync(
    options: RequestOptions = {}
  ): Promise<DeviceRunSessionApplication> {
    return await this.requestAsync(
      'GET',
      'application',
      DeviceRunSessionApplicationSchema,
      options
    );
  }

  private async requestAsync<T>(
    method: 'GET' | 'POST',
    route: string,
    dataSchema: z.ZodType<T>,
    { retries = 0, ...options }: RequestOptions & { json?: Record<string, unknown> }
  ): Promise<T> {
    const request = () => {
      options.signal?.throwIfAborted();
      return this.requestOnceAsync(method, route, dataSchema, options);
    };
    if (retries === 0) {
      return await request();
    }
    return await promiseRetryWithCondition(
      request,
      error =>
        !options.signal?.aborted &&
        error instanceof DeviceRunSessionWorkerApiError &&
        (error.status === undefined || error.status === 429 || error.status >= 500),
      { retries, factor: 2, minTimeout: 1000 },
      ({ attemptNumber, maxAttemptsCount }) =>
        options.logger?.warn(
          `Retrying ${method} /v2/${DEVICE_RUN_SESSION_WORKER_PATH}${route} (attempt ${attemptNumber}/${maxAttemptsCount}).`
        )
    )();
  }

  private async requestOnceAsync<T>(
    method: 'GET' | 'POST',
    route: string,
    dataSchema: z.ZodType<T>,
    {
      signal,
      timeoutMs,
      logger,
      json,
    }: Omit<RequestOptions, 'retries'> & {
      json?: Record<string, unknown>;
    }
  ): Promise<T> {
    const routeDescription = `${method} /v2/${DEVICE_RUN_SESSION_WORKER_PATH}${route}`;
    const url = new URL(
      `${DEVICE_RUN_SESSION_WORKER_PATH}${route}`,
      this.expoApiV2BaseUrl
    ).toString();

    const responseResult = await asyncResult(
      turtleFetch(url, method, {
        headers: { [DEVICE_RUN_SESSION_TOKEN_HEADER]: this.deviceRunSessionToken },
        ...(json ? { json } : {}),
        ...(signal ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
        retries: 0,
        shouldThrowOnNotOk: false,
        logger,
      })
    );
    if (!responseResult.ok) {
      const reason = responseResult.reason;
      throw new DeviceRunSessionWorkerApiError(
        `${routeDescription} failed before www responded: ${
          reason instanceof Error ? reason.message : String(reason)
        }. Check the network connection of the worker.`,
        undefined,
        { cause: reason }
      );
    }
    const response = responseResult.value;

    const bodyResult = await asyncResult(response.json());
    if (!response.ok) {
      const apiError = bodyResult.ok ? ApiV2ErrorResponseSchema.safeParse(bodyResult.value) : null;
      const apiErrorMessage = apiError?.success
        ? apiError.data.errors.map(error => error.message).join(' ')
        : response.statusText;
      throw new DeviceRunSessionWorkerApiError(
        `${routeDescription} failed with status ${response.status}: ${apiErrorMessage}`,
        response.status
      );
    }
    if (!bodyResult.ok) {
      if (
        bodyResult.reason instanceof FetchError &&
        ['system', 'body-timeout'].includes(bodyResult.reason.type)
      ) {
        throw new DeviceRunSessionWorkerApiError(
          `${routeDescription} failed while reading the response body.`,
          undefined
        );
      }
      throw new DeviceRunSessionWorkerApiError(
        `${routeDescription} returned a response that is not JSON.`,
        response.status
      );
    }
    const parsed = z.object({ data: dataSchema }).safeParse(bodyResult.value);
    if (!parsed.success) {
      throw new DeviceRunSessionWorkerApiError(
        `${routeDescription} returned an unexpected response: ${parsed.error.message}`,
        response.status
      );
    }
    return parsed.data.data;
  }
}

/**
 * Returns the device run session token when www gave one to this job, or null. Without a token,
 * callers keep using the robot access token and the account-wide API.
 */
export function getDeviceRunSessionToken(
  env: Record<string, string | undefined> | undefined
): string | null {
  const token = env?.[DEVICE_RUN_SESSION_TOKEN_ENV];
  return token ? token : null;
}

/**
 * Returns the device run session token from the job's environment secrets, or null. It resolves
 * duplicate names like the build context env does (the last secret wins), so the worker and the
 * steps use the same token. A file secret is not a token.
 */
export function getDeviceRunSessionTokenFromEnvironmentSecrets(
  environmentSecrets: EnvironmentSecret[] | undefined
): string | null {
  const secret = [...(environmentSecrets ?? [])]
    .reverse()
    .find(({ name }) => name === DEVICE_RUN_SESSION_TOKEN_ENV);
  if (!secret || secret.type !== EnvironmentSecretType.STRING || !secret.value) {
    return null;
  }
  return secret.value;
}

/**
 * Returns a client for the device run session worker API when this job has a device run session
 * token, or null when it does not.
 */
export function getDeviceRunSessionWorkerApi(
  ctx: Pick<CustomBuildContext, 'env' | 'expoApiV2BaseUrl'>
): DeviceRunSessionWorkerApi | null {
  const token = getDeviceRunSessionToken(ctx.env);
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

function getExpoApiV2BaseUrl(ctx: Pick<CustomBuildContext, 'env' | 'expoApiV2BaseUrl'>): string {
  if (ctx.expoApiV2BaseUrl) {
    return ctx.expoApiV2BaseUrl;
  }
  if (ctx.env.__API_SERVER_URL) {
    return new URL('/v2/', ctx.env.__API_SERVER_URL).toString();
  }
  throw new SystemError(
    `${DEVICE_RUN_SESSION_TOKEN_ENV} is set, but the API server URL is not. ` +
      'The worker cannot call the device run session API without it. ' +
      'Check that the worker sets __API_SERVER_URL for device run session jobs.'
  );
}
