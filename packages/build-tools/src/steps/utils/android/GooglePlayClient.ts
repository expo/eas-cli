import { UserError } from '@expo/eas-build-job';
import fetch, { RequestInit, Response } from 'node-fetch';
import { createPrivateKey, sign } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const API_ORIGIN = 'https://androidpublisher.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_RETRIES = 5;

export type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
};

/** Do not retain a request, URL, body, or credentials in errors that the worker may log. */
export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[]
  ) {
    super(`Google Play request failed (HTTP ${status}).`);
  }
}

class GooglePlayNetworkError extends Error {
  constructor() {
    super('Google Play request failed before a response was received.');
  }
}

/** One client per submission. Credentials are parsed at the function boundary. */
export class GooglePlayClient {
  private token?: { value: string; expiresAt: number };
  private tokenRequest?: Promise<string>;
  private readonly key: ReturnType<typeof createPrivateKey>;

  constructor(private readonly credentials: GoogleServiceAccount) {
    try {
      this.key = createPrivateKey(credentials.private_key);
    } catch {
      throw new UserError(
        'EAS_GOOGLE_PLAY_INVALID_CREDENTIALS',
        'Expected a valid RSA private key for the Google service account; the supplied key could not be parsed.'
      );
    }
    if (this.key.asymmetricKeyType !== 'rsa') {
      throw new UserError(
        'EAS_GOOGLE_PLAY_INVALID_CREDENTIALS',
        `Expected an RSA private key for the Google service account; received ${this.key.asymmetricKeyType ?? 'unknown'} key type.`
      );
    }
  }

  async requestAsync<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    const response = await this.requestRawAsync(apiPath, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
    return response.status === 204 ? (undefined as T) : await this.readJsonAsync<T>(response);
  }

  private checkUrl(url: URL): void {
    // Use the exact publisher host. Never attach credentials to a supplied host or redirect.
    if (url.origin !== API_ORIGIN || url.username || url.password) {
      throw new Error('Google returned an unsafe upload URL.');
    }
  }

  async requestRawAsync(
    apiPath: string | URL,
    init: RequestInit,
    allowResume = false
  ): Promise<Response> {
    const url = new URL(apiPath, API_ORIGIN);
    this.checkUrl(url);
    const token = await this.getTokenAsync(init.signal ?? undefined);
    const response = await this.fetchAsync(url.toString(), {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      redirect: 'manual',
    });
    if (!response.ok && !(allowResume && response.status === 308)) {
      await this.throwApiErrorAsync(response);
    }
    return response;
  }

  private async fetchAsync(url: string, init: RequestInit): Promise<Response> {
    init.signal?.throwIfAborted();
    try {
      return await fetch(url, init);
    } catch {
      init.signal?.throwIfAborted();
      throw new GooglePlayNetworkError();
    }
  }

  async readJsonAsync<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      // node-fetch JSON/body errors include the request URL, which can be signed.
      throw new GooglePlayNetworkError();
    }
  }

  private async throwApiErrorAsync(response: Response): Promise<never> {
    let data: { error?: { message?: unknown; errors?: { reason?: unknown }[] } } = {};
    try {
      data = await response.json();
    } catch {
      // HTML, redirects, and proxy errors must not expose a request URL or token.
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

  private async getTokenAsync(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (this.token && Date.now() < this.token.expiresAt - 60_000) {
      return this.token.value;
    }
    if (!this.tokenRequest) {
      this.tokenRequest = this.refreshTokenAsync(signal).finally(() => {
        this.tokenRequest = undefined;
      });
    }
    return await this.tokenRequest;
  }

  private async refreshTokenAsync(signal?: AbortSignal): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({
      alg: 'RS256',
      typ: 'JWT',
      ...(this.credentials.private_key_id ? { kid: this.credentials.private_key_id } : {}),
    });
    const payload = encode({
      iss: this.credentials.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    });
    const unsigned = `${header}.${payload}`;
    const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), this.key).toString('base64url')}`;
    const startedAt = Date.now();
    const response = await this.retryAsync(async () => {
      const response = await this.fetchAsync(TOKEN_URL, {
        method: 'POST',
        redirect: 'manual',
        signal,
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
      if (!response.ok) {
        // OAuth error bodies can include parts of the credential assertion.
        throw new GooglePlayApiError(response.status, '', []);
      }
      return response;
    }, signal).catch(error => {
      if (error instanceof GooglePlayApiError) {
        throw new UserError(
          'EAS_GOOGLE_PLAY_AUTH_FAILED',
          `Google could not authorize the service account (HTTP ${error.status}). Check its key and Google API access.`
        );
      }
      throw error;
    });
    const data = await this.readJsonAsync<{
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    }>(response);
    if (
      !data?.access_token ||
      typeof data?.access_token !== 'string' ||
      !Number.isFinite(data?.expires_in) ||
      data?.expires_in! <= 60 ||
      data?.token_type?.toLowerCase() !== 'bearer'
    ) {
      throw new Error('Google did not return a valid OAuth token.');
    }
    this.token = { value: data?.access_token, expiresAt: startedAt + data?.expires_in! * 1000 };
    return this.token.value;
  }

  isRetryable(error: unknown): boolean {
    return (
      error instanceof GooglePlayNetworkError ||
      (error instanceof GooglePlayApiError && (error.status === 429 || error.status >= 500))
    );
  }

  async waitAsync(attempt: number, signal?: AbortSignal): Promise<void> {
    await delay(
      Math.min(2 ** attempt * 1000, 32_000) + Math.floor(Math.random() * 1000),
      undefined,
      { signal }
    );
  }

  async retryAsync<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        if (!this.isRetryable(error) || attempt >= MAX_RETRIES) {
          throw error;
        }
        await this.waitAsync(attempt, signal);
      }
    }
  }
}
