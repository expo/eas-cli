import { SystemError } from '@expo/eas-build-job';
import fetch, { RequestInit, Response } from 'node-fetch';
import { z } from 'zod';

import { GooglePlayAuthUtils, GoogleServiceAccount } from './GooglePlayAuthUtils';

export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[]
  ) {
    super(`Google Play request failed (HTTP ${status})${apiMessage ? `: ${apiMessage}` : '.'}`);
  }
}

const ReleaseStatusZ = z.enum(['draft', 'inProgress', 'halted', 'completed']);

const ReleaseNoteZ = z.object({
  language: z.string(),
  text: z.string(),
});

const ReleaseZ = z.object({
  name: z.string().optional(),
  versionCodes: z.array(z.string()),
  status: ReleaseStatusZ,
  userFraction: z.number().gt(0).lt(1).optional(),
  releaseNotes: z.array(ReleaseNoteZ).optional(),
});

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
      releases: z.array(ReleaseZ).optional(),
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
      releases: z.array(ReleaseZ).optional(),
    }),
    query: z.object({}),
    response: z.object({
      track: z.string().min(1),
      releases: z.array(ReleaseZ).optional(),
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

    const pending = GooglePlayAuthUtils.createTokenAsync(this.serviceAccount, signal);
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

  async startUploadAsync({
    packageName,
    editId,
    artifactType,
    size,
    signal,
  }: {
    packageName: string;
    editId: string;
    artifactType: 'apk' | 'aab';
    size: number;
    signal?: AbortSignal;
  }): Promise<URL> {
    const resource = artifactType === 'apk' ? 'apks' : 'bundles';
    const response = await this.requestAsync(
      'POST',
      `/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/${resource}?uploadType=resumable`,
      undefined,
      signal,
      {
        'Content-Length': '0',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type':
          artifactType === 'apk'
            ? 'application/vnd.android.package-archive'
            : 'application/octet-stream',
      }
    );
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Google did not return an upload session.');
    }
    let url: URL;
    try {
      url = new URL(location);
    } catch {
      throw new Error('Google returned an invalid upload URL.');
    }
    if (url.origin !== this.baseUrl || url.username || url.password) {
      throw new Error('Google returned an unsafe upload URL.');
    }
    return url;
  }

  private async sendJsonRequestAsync(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
      signal
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

  private async requestAsync(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: string,
    signal?: AbortSignal,
    headers: RequestInit['headers'] = { 'Content-Type': 'application/json' }
  ): Promise<Response> {
    const url = new URL(path, this.baseUrl);
    const token = await this.getTokenAsync(signal);
    let response: Response;
    signal?.throwIfAborted();
    try {
      response = await fetch(url.toString(), {
        method,
        body,
        signal,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        redirect: 'manual',
      });
    } catch {
      signal?.throwIfAborted();
      throw new SystemError('Google Play request failed before a response was received.');
    }

    if (!response.ok) {
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
