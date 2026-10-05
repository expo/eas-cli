import { SystemError } from '@expo/eas-build-job';
import * as jose from 'jose';
import { KeyObject } from 'node:crypto';
import fetch, { RequestInit, Response } from 'node-fetch';
import { z } from 'zod';

import { GooglePlayAuthClient } from './GooglePlayAuthClient';

export type GoogleServiceAccount = {
  client_email: string;
  private_key: KeyObject;
  private_key_id?: string;
};

export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[]
  ) {
    super(`Google Play request failed (HTTP ${status})${apiMessage ? `: ${apiMessage}` : '.'}`);
  }
}

const GetApi = {
  '/androidpublisher/v3/applications/:packageName/edits/:editId': {
    path: z.object({ packageName: z.string().min(1), editId: z.string().min(1) }),
    request: z.object({}),
    query: z.object({}),
    response: z.object({ id: z.string().min(1), expiryTimeSeconds: z.string().optional() }),
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId/tracks/:track': {
    path: z.object({
      packageName: z.string().min(1),
      editId: z.string().min(1),
      track: z.string().min(1),
    }),
    request: z.object({}),
    query: z.object({}),
    response: z.object({
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
    }),
  },
};
const PostApi = {
  '/androidpublisher/v3/applications/:packageName/edits': {
    path: z.object({ packageName: z.string().min(1) }),
    request: z.object({}),
    query: z.object({}),
    response: z.object({ id: z.string().min(1), expiryTimeSeconds: z.string().optional() }),
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId:commit': {
    path: z.object({ packageName: z.string().min(1), editId: z.string().min(1) }),
    request: z.object({}),
    query: z.object({ changesNotSentForReview: z.boolean().optional() }),
    response: z.object({ id: z.string().min(1), expiryTimeSeconds: z.string().optional() }),
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId:validate': {
    path: z.object({ packageName: z.string().min(1), editId: z.string().min(1) }),
    request: z.object({}),
    query: z.object({}),
    response: z.object({ id: z.string().min(1), expiryTimeSeconds: z.string().optional() }),
  },
};
const PutApi = {
  '/androidpublisher/v3/applications/:packageName/edits/:editId/tracks/:track': {
    path: z.object({
      packageName: z.string().min(1),
      editId: z.string().min(1),
      track: z.string().min(1),
    }),
    request: z.object({
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
    }),
    query: z.object({}),
    response: z.object({
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
    }),
  },
};
const DeleteApi = {
  '/androidpublisher/v3/applications/:packageName/edits/:editId': {
    path: z.object({ packageName: z.string().min(1), editId: z.string().min(1) }),
  },
};

export class GooglePlayClient {
  private readonly baseUrl = 'https://androidpublisher.googleapis.com';
  private readonly authClient = new GooglePlayAuthClient();
  private cachedToken?: Promise<{ value: string; expiresAt: number }>;

  constructor(private readonly serviceAccount: GoogleServiceAccount) {}

  private async getTokenAsync(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    while (this.cachedToken) {
      const pending = this.cachedToken;
      const cached = await pending;
      signal?.throwIfAborted();
      if (Date.now() < cached.expiresAt - 60_000) {
        return cached.value;
      }
      if (this.cachedToken === pending) {
        break;
      }
    }
    const pending = this.loadTokenAsync(signal);
    this.cachedToken = pending;
    try {
      return (await pending).value;
    } catch (error) {
      if (this.cachedToken === pending) {
        this.cachedToken = undefined;
      }
      throw error;
    }
  }

  private async loadTokenAsync(
    signal?: AbortSignal
  ): Promise<{ value: string; expiresAt: number }> {
    const startedAt = Date.now();
    const assertion = await new jose.SignJWT({
      scope: 'https://www.googleapis.com/auth/androidpublisher',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: this.serviceAccount.private_key_id })
      .setIssuer(this.serviceAccount.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(this.serviceAccount.private_key);
    const response = await this.authClient.postAsync(
      '/token',
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      },
      signal
    );
    return { value: response.access_token, expiresAt: startedAt + response.expires_in * 1000 };
  }

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
      throw new SystemError(
        `Could not read the Google Play JSON response (HTTP ${response.status}).`
      );
    }
    const parsed = schema.response.safeParse(data);
    if (!parsed.success) {
      throw new SystemError(
        `Malformed response from Google Play (HTTP ${response.status}): ${z.prettifyError(parsed.error)}`
      );
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
    const url = new URL(apiPath, this.baseUrl);
    if (url.origin !== this.baseUrl || url.username || url.password) {
      throw new SystemError(
        'Google Play request URL must use the publisher host without URL credentials.'
      );
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
      throw new SystemError('Google Play request failed before a response was received.');
    }
    if (!response.ok && !(options.allowResume && response.status === 308)) {
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        signal?.throwIfAborted();
      }
      const parsed = z
        .object({
          error: z.object({
            message: z.string().optional(),
            errors: z.array(z.object({ reason: z.string().optional() })).optional(),
          }),
        })
        .safeParse(data);
      throw new GooglePlayApiError(
        response.status,
        parsed.success ? (parsed.data.error.message ?? '') : '',
        parsed.success
          ? (parsed.data.error.errors?.flatMap(error => (error.reason ? [error.reason] : [])) ?? [])
          : []
      );
    }
    return response;
  }
}
