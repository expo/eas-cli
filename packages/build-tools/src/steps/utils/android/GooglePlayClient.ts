import { UserError } from '@expo/eas-build-job';
import * as jose from 'jose';
import { KeyObject } from 'node:crypto';
import fetch, { RequestInit, Response } from 'node-fetch';
import { z } from 'zod';

import { GooglePlayAuthClient } from './GooglePlayAuthClient';
import { GooglePlayApiError, GooglePlayNetworkError } from './GooglePlayErrors';
import { promiseRetryWithCondition } from '../../../utils/promiseRetryWithCondition';

export { GooglePlayApiError, GooglePlayNetworkError } from './GooglePlayErrors';
export type GoogleServiceAccount = {
  client_email: string;
  private_key: KeyObject;
  private_key_id?: string;
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ORIGIN = 'https://androidpublisher.googleapis.com';
const EmptyZ = z.object({});
const PackagePathZ = z.object({ packageName: z.string().min(1) });
const EditPathZ = PackagePathZ.extend({ editId: z.string().min(1) });
const TrackPathZ = EditPathZ.extend({ track: z.string().min(1) });
const EditZ = z.object({ id: z.string().min(1), expiryTimeSeconds: z.string().optional() });
const TrackZ = z.object({
  track: z.string().min(1),
  releases: z
    .array(
      z.object({
        name: z.string().optional(),
        versionCodes: z.array(z.string()),
        status: z.enum(['draft', 'inProgress', 'halted', 'completed']),
        userFraction: z.number().gt(0).lt(1).optional(),
        releaseNotes: z.array(z.object({ language: z.string(), text: z.string() })).optional(),
      })
    )
    .optional(),
});

const GetApi = {
  '/androidpublisher/v3/applications/:packageName/edits/:editId': {
    path: EditPathZ,
    request: EmptyZ,
    query: EmptyZ,
    response: EditZ,
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId/tracks/:track': {
    path: TrackPathZ,
    request: EmptyZ,
    query: EmptyZ,
    response: TrackZ,
  },
};
const PostApi = {
  '/androidpublisher/v3/applications/:packageName/edits': {
    path: PackagePathZ,
    request: EmptyZ,
    query: EmptyZ,
    response: EditZ,
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId:commit': {
    path: EditPathZ,
    request: EmptyZ,
    query: z.object({ changesNotSentForReview: z.boolean().optional() }),
    response: EditZ,
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId:validate': {
    path: EditPathZ,
    request: EmptyZ,
    query: EmptyZ,
    response: EditZ,
  },
};
const PutApi = {
  '/androidpublisher/v3/applications/:packageName/edits/:editId/tracks/:track': {
    path: TrackPathZ,
    request: TrackZ,
    query: EmptyZ,
    response: TrackZ,
  },
};
const DeleteApi = {
  '/androidpublisher/v3/applications/:packageName/edits/:editId': { path: EditPathZ },
};

export class GooglePlayClient {
  private cachedToken?: { value: Promise<string>; expiresAt: number };

  constructor(
    private readonly serviceAccount: GoogleServiceAccount,
    private readonly authClient = new GooglePlayAuthClient()
  ) {}

  async getAsync<TPath extends keyof typeof GetApi>(
    path: TPath,
    params: z.input<(typeof GetApi)[TPath]['path']>,
    signal?: AbortSignal
  ): Promise<z.output<(typeof GetApi)[TPath]['response']>> {
    return await this.sendJsonRequestAsync('GET', path, GetApi[path], {}, params, {}, signal);
  }

  async postAsync<TPath extends keyof typeof PostApi>(
    path: TPath,
    body: z.input<(typeof PostApi)[TPath]['request']>,
    params: z.input<(typeof PostApi)[TPath]['path']>,
    options: { query?: z.input<(typeof PostApi)[TPath]['query']>; signal?: AbortSignal } = {}
  ): Promise<z.output<(typeof PostApi)[TPath]['response']>> {
    return await this.sendJsonRequestAsync(
      'POST',
      path,
      PostApi[path],
      body,
      params,
      options.query ?? {},
      options.signal
    );
  }

  async putAsync<TPath extends keyof typeof PutApi>(
    path: TPath,
    body: z.input<(typeof PutApi)[TPath]['request']>,
    params: z.input<(typeof PutApi)[TPath]['path']>,
    signal?: AbortSignal
  ): Promise<z.output<(typeof PutApi)[TPath]['response']>> {
    return await this.sendJsonRequestAsync('PUT', path, PutApi[path], body, params, {}, signal);
  }

  async deleteAsync<TPath extends keyof typeof DeleteApi>(
    path: TPath,
    params: z.input<(typeof DeleteApi)[TPath]['path']>,
    signal?: AbortSignal
  ): Promise<void> {
    let url: string = path;
    for (const [key, value] of Object.entries(DeleteApi[path].path.parse(params))) {
      url = url.replace(`:${key}`, encodeURIComponent(value));
    }
    await this.requestAsync('DELETE', url, undefined, signal);
  }

  private async sendJsonRequestAsync(
    method: string,
    path: string,
    schema: {
      path: z.ZodType<Record<string, string>>;
      request: z.ZodType;
      query: z.ZodType;
      response: z.ZodType;
    },
    body: unknown,
    params: unknown,
    query: unknown,
    signal?: AbortSignal
  ): Promise<any> {
    const parsedBody = schema.request.parse(body);
    for (const [key, value] of Object.entries(schema.path.parse(params))) {
      path = path.replace(`:${key}`, encodeURIComponent(value));
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(
      schema.query.parse(query) as Record<string, unknown>
    )) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    const response = await this.requestAsync(
      method,
      search.size ? `${path}?${search}` : path,
      method === 'GET' ? undefined : JSON.stringify(parsedBody),
      signal,
      { headers: { 'Content-Type': 'application/json' } }
    );
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      signal?.throwIfAborted();
      throw new GooglePlayNetworkError();
    }
    const parsed = schema.response.safeParse(data);
    if (!parsed.success) {
      throw new Error('Google Play returned an invalid response.');
    }
    return parsed.data;
  }

  async requestAsync(
    method: string,
    apiPath: string | URL,
    body?: RequestInit['body'],
    signal?: AbortSignal,
    options: { headers?: RequestInit['headers']; allowResume?: boolean } = {}
  ): Promise<Response> {
    const url = new URL(apiPath, API_ORIGIN);
    if (url.origin !== API_ORIGIN || url.username || url.password) {
      throw new Error('Google returned an unsafe upload URL.');
    }
    const token = await this.getTokenAsync(signal);
    let response: Response;
    signal?.throwIfAborted();
    try {
      response = await fetch(url.toString(), {
        method,
        body,
        signal,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
        redirect: 'manual',
      });
    } catch {
      signal?.throwIfAborted();
      throw new GooglePlayNetworkError();
    }
    if (!response.ok && !(options.allowResume && response.status === 308)) {
      let data: { error?: { message?: unknown; errors?: { reason?: unknown }[] } } = {};
      try {
        data = await response.json();
      } catch {
        // HTML, redirects, and proxy errors must not expose a request URL or token.
        signal?.throwIfAborted();
      }
      throw new GooglePlayApiError(
        response.status,
        typeof data?.error?.message === 'string' ? data.error.message : '',
        Array.isArray(data?.error?.errors)
          ? data.error.errors.flatMap(error =>
              typeof error.reason === 'string' ? [error.reason] : []
            )
          : []
      );
    }
    return response;
  }

  private async getTokenAsync(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (!this.cachedToken || Date.now() >= this.cachedToken.expiresAt - 60_000) {
      this.cachedToken = { value: this.refreshTokenAsync(signal), expiresAt: Infinity };
    }
    const cachedToken = this.cachedToken;
    try {
      return await cachedToken.value;
    } catch (error) {
      if (this.cachedToken === cachedToken) {
        this.cachedToken = undefined;
      }
      throw error;
    }
  }

  private async refreshTokenAsync(signal?: AbortSignal): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new jose.SignJWT({
      scope: 'https://www.googleapis.com/auth/androidpublisher',
    })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        ...(this.serviceAccount.private_key_id ? { kid: this.serviceAccount.private_key_id } : {}),
      })
      .setIssuer(this.serviceAccount.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(this.serviceAccount.private_key);
    const startedAt = Date.now();
    let response: Awaited<ReturnType<GooglePlayAuthClient['postAsync']>>;
    try {
      response = await promiseRetryWithCondition(
        () =>
          this.authClient.postAsync(
            '/token',
            {
              grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
              assertion,
            },
            signal
          ),
        error =>
          error instanceof GooglePlayNetworkError ||
          (error instanceof GooglePlayApiError && (error.status === 429 || error.status >= 500)),
        {
          retries: 5,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 32_000,
          randomize: true,
          signal,
        }
      )();
    } catch (error) {
      if (error instanceof GooglePlayApiError) {
        throw new UserError(
          'EAS_GOOGLE_PLAY_AUTH_FAILED',
          `Google could not authorize the service account (HTTP ${error.status}). Check its key and Google API access.`
        );
      }
      throw error;
    }
    if (this.cachedToken) {
      this.cachedToken.expiresAt = startedAt + response.expires_in * 1000;
    }
    return response.access_token;
  }
}
