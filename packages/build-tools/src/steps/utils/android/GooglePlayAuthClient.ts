import { SystemError } from '@expo/eas-build-job';
import { asyncResult } from '@expo/results';
import fetch, { Response } from 'node-fetch';
import { z } from 'zod';

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

export class GooglePlayAuthRequestError extends Error {
  constructor(public readonly status: number) {
    super(`Google Play OAuth request failed (HTTP ${status}).`);
  }
}

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
    requestSchema: z.ZodType<any>;
    responseSchema: z.ZodType<any>;
    signal?: AbortSignal;
  }): Promise<any> {
    const parsedBody = await asyncResult((async () => requestSchema.parse(body))());
    if (!parsedBody.ok) {
      throw new Error('Invalid Google OAuth token request.');
    }
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl).toString(), {
        method,
        redirect: 'manual',
        signal,
        body: new URLSearchParams(parsedBody.value),
      });
    } catch {
      signal?.throwIfAborted();
      throw new SystemError('Google Play OAuth request failed before a response was received.');
    }
    if (!response.ok) {
      throw new GooglePlayAuthRequestError(response.status);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      signal?.throwIfAborted();
      throw new SystemError('Could not read the Google Play OAuth response.');
    }
    const parsedJson = await asyncResult((async () => JSON.parse(text))());
    if (!parsedJson.ok) {
      throw new SystemError('Malformed JSON response from Google Play OAuth.');
    }
    const parsedResponse = await asyncResult(
      (async () => responseSchema.parse(parsedJson.value))()
    );
    if (!parsedResponse.ok) {
      throw new SystemError('Google did not return a valid OAuth token.');
    }
    return parsedResponse.value;
  }
}
