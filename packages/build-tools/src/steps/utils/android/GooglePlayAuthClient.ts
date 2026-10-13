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

const OAuthErrorZ = z.enum([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
]);

export class GooglePlayAuthRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode?: z.output<typeof OAuthErrorZ>
  ) {
    super(`Google Play OAuth request failed (HTTP ${status})${errorCode ? `: ${errorCode}` : ''}.`);
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
      throw new Error(
        `Malformed request to Google Play OAuth: ${z.prettifyError(
          parsedBody.enforceError() as z.ZodError
        )}`
      );
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
    } catch (cause) {
      signal?.throwIfAborted();
      throw new SystemError('Google Play OAuth request failed before a response was received.', {
        cause,
      });
    }
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      signal?.throwIfAborted();
      throw new SystemError(
        `Could not read the Google Play OAuth response (HTTP ${response.status}).`,
        {
          cause,
        }
      );
    }
    const parsedJson = await asyncResult((async () => JSON.parse(text))());
    if (!response.ok) {
      const errorCode = OAuthErrorZ.safeParse(parsedJson.ok ? parsedJson.value?.error : undefined);
      throw new GooglePlayAuthRequestError(
        response.status,
        errorCode.success ? errorCode.data : undefined
      );
    }
    if (!parsedJson.ok) {
      throw new SystemError(
        `Malformed JSON response from Google Play OAuth (HTTP ${response.status}).`
      );
    }
    const parsedResponse = await asyncResult(
      (async () => responseSchema.parse(parsedJson.value))()
    );
    if (!parsedResponse.ok) {
      throw new SystemError(
        `Malformed response from Google Play OAuth (HTTP ${response.status}): ${z.prettifyError(
          parsedResponse.enforceError() as z.ZodError
        )}`
      );
    }
    return parsedResponse.value;
  }
}
