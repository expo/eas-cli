import { SystemError } from '@expo/eas-build-job';
import fetch, { RequestInit, Response } from 'node-fetch';
import { z } from 'zod';

export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[]
  ) {
    super(`Google Play request failed (HTTP ${status}).`);
  }
}

const GetApi = {
  '/androidpublisher/v3/applications/:packageName/edits/:editId': {
    path: z.object({ packageName: z.string().min(1), editId: z.string().min(1) }),
    request: z.strictObject({}),
    query: z.strictObject({}),
    response: z.object({ id: z.string().min(1), expiryTimeSeconds: z.string().optional() }),
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId/tracks/:track': {
    path: z.object({
      packageName: z.string().min(1),
      editId: z.string().min(1),
      track: z.string().min(1),
    }),
    request: z.strictObject({}),
    query: z.strictObject({}),
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
    request: z.strictObject({}),
    query: z.strictObject({}),
    response: z.object({ id: z.string().min(1), expiryTimeSeconds: z.string().optional() }),
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId:commit': {
    path: z.object({ packageName: z.string().min(1), editId: z.string().min(1) }),
    request: z.strictObject({}),
    query: z.object({ changesNotSentForReview: z.boolean().optional() }),
    response: z.object({ id: z.string().min(1), expiryTimeSeconds: z.string().optional() }),
  },
  '/androidpublisher/v3/applications/:packageName/edits/:editId:validate': {
    path: z.object({ packageName: z.string().min(1), editId: z.string().min(1) }),
    request: z.strictObject({}),
    query: z.strictObject({}),
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
    query: z.strictObject({}),
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
  private readonly token: string;

  constructor({ token }: { token: string }) {
    this.token = token;
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
      throw new SystemError('Google Play request failed.');
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
    const url = new URL(apiPath, this.baseUrl);
    if (url.origin !== this.baseUrl || url.username || url.password) {
      throw new Error('Google returned an unsafe upload URL.');
    }
    let response: Response;
    signal?.throwIfAborted();
    try {
      response = await fetch(url.toString(), {
        method,
        body,
        signal,
        headers: { ...options.headers, Authorization: `Bearer ${this.token}` },
        redirect: 'manual',
      });
    } catch {
      signal?.throwIfAborted();
      throw new SystemError('Google Play request failed.');
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
}
