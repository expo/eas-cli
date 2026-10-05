import fetch, { Response } from 'node-fetch';
import { z } from 'zod';

import { GooglePlayApiError, GooglePlayNetworkError } from './GooglePlayErrors';

const PostApi = {
  '/token': {
    request: z.object({
      grant_type: z.literal('urn:ietf:params:oauth:grant-type:jwt-bearer'),
      assertion: z.string().min(1),
    }),
    response: z.object({
      access_token: z.string().min(1),
      expires_in: z.number().finite().gt(60),
      token_type: z.string().refine(value => value.toLowerCase() === 'bearer'),
    }),
  },
};

export class GooglePlayAuthClient {
  private readonly baseUrl = 'https://oauth2.googleapis.com';

  async postAsync<TPath extends keyof typeof PostApi>(
    path: TPath,
    body: z.input<(typeof PostApi)[TPath]['request']>,
    signal?: AbortSignal
  ): Promise<z.output<(typeof PostApi)[TPath]['response']>> {
    const schema = PostApi[path];
    return await this.requestAsync({
      method: 'POST',
      path,
      body,
      requestSchema: schema.request,
      responseSchema: schema.response,
      signal,
    });
  }

  private async requestAsync({
    method,
    path,
    body,
    requestSchema,
    responseSchema,
    signal,
  }: {
    method: 'POST';
    path: string;
    body: unknown;
    requestSchema: z.ZodType<Record<string, string>>;
    responseSchema: z.ZodType;
    signal?: AbortSignal;
  }): Promise<any> {
    const parsedBody = requestSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new Error('Invalid Google OAuth token request.');
    }
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl).toString(), {
        method,
        redirect: 'manual',
        signal,
        body: new URLSearchParams(parsedBody.data),
      });
    } catch {
      signal?.throwIfAborted();
      throw new GooglePlayNetworkError();
    }
    if (!response.ok) {
      throw new GooglePlayApiError(response.status, '', []);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      signal?.throwIfAborted();
      throw new GooglePlayNetworkError();
    }
    const parsed = responseSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error('Google did not return a valid OAuth token.');
    }
    return parsed.data;
  }
}
