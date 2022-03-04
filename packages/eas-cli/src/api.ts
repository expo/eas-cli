import { JSONValue } from '@expo/json-file';
import fetch, { RequestInit, Response } from 'node-fetch';

import { getAccessToken, getSessionSecret } from './user/sessionStorage';

export class ApiV2Error extends Error {
  readonly name = 'ApiV2Error';
  readonly expoApiV2ErrorCode: string;
  readonly expoApiV2ErrorDetails?: JSONValue;
  readonly expoApiV2ErrorServerStack?: string;
  readonly expoApiV2ErrorMetadata?: object;

  constructor(response: {
    message: string;
    code: string;
    stack?: string;
    details?: JSONValue;
    metadata?: object;
  }) {
    super(response.message);
    this.expoApiV2ErrorCode = response.code;
    this.expoApiV2ErrorDetails = response.details;
    this.expoApiV2ErrorServerStack = response.stack;
    this.expoApiV2ErrorMetadata = response.metadata;
  }
}

interface RequestOptions {
  body: JSONValue;
}

class ApiV2 {
  public async putAsync(path: string, options: RequestOptions): Promise<any> {
    return await this.requestAsync(path, { method: 'PUT', body: JSON.stringify(options.body) });
  }

  public async postAsync(path: string, options: RequestOptions): Promise<any> {
    return await this.requestAsync(path, { method: 'POST', body: JSON.stringify(options.body) });
  }

  public async deleteAsync(path: string): Promise<any> {
    return await this.requestAsync(path, { method: 'DELETE' });
  }

  public async getAsync(path: string): Promise<any> {
    return await this.requestAsync(path, { method: 'GET' });
  }

  private async requestAsync(path: string, options: RequestInit): Promise<any> {
    const response = await fetch(`${getExpoApiBaseUrl()}/v2/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
    });
    await this.handleApiErrorAsync(response);
    return await response.json();
  }

  private async handleApiErrorAsync(response: Response): Promise<void> {
    if (response.status >= 400) {
      let result: { [key: string]: any };
      try {
        result = await response.json();
      } catch {
        throw new Error(`Malformed api response: ${await response.text()}`);
      }
      if (result.errors?.length) {
        throw new ApiV2Error(result.errors[0]);
      }
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const token = getAccessToken();
    if (token) {
      return { authorization: `Bearer ${token}` };
    }
    const sessionSecret = getSessionSecret();
    if (sessionSecret) {
      return { 'expo-session': sessionSecret };
    }
    return {};
  }
}

export const api = new ApiV2();

export function getExpoApiBaseUrl(): string {
  if (process.env.EXPO_STAGING) {
    return `https://staging-api.expo.dev`;
  } else if (process.env.EXPO_LOCAL) {
    return `http://127.0.0.1:3000`;
  } else {
    return `https://api.expo.dev`;
  }
}

export function getExpoWebsiteBaseUrl(): string {
  if (process.env.EXPO_STAGING) {
    return `https://staging.expo.dev`;
  } else if (process.env.EXPO_LOCAL) {
    return `http://expo.test`;
  } else {
    return `https://expo.dev`;
  }
}

export function getEASUpdateURL(projectId: string): string {
  if (process.env.EXPO_STAGING) {
    return new URL(projectId, `https://staging-u.expo.dev`).href;
  } else if (process.env.EXPO_LOCAL) {
    return new URL(`expo-updates/${projectId}`, `http://127.0.0.1:3000`).href;
  } else {
    return new URL(projectId, `https://u.expo.dev`).href;
  }
}
