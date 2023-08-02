import { JSONValue } from '@expo/json-file';

import { ApiV2Error } from './ApiV2Error';
import fetch, { RequestError, RequestInit } from './fetch';

interface RequestOptions {
  body: JSONValue;
}

export class ApiV2Client {
  constructor(
    private readonly authInfo: {
      accessToken: string | null;
      sessionSecret: string | null;
    }
  ) {}

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

  private getAuthHeaders(): Record<string, string> {
    const token = this.authInfo.accessToken;
    if (token) {
      return { authorization: `Bearer ${token}` };
    }
    const sessionSecret = this.authInfo.sessionSecret;
    if (sessionSecret) {
      return { 'expo-session': sessionSecret };
    }
    return {};
  }

  private async requestAsync(path: string, options: RequestInit): Promise<any> {
    try {
      const response = await fetch(`${getExpoApiBaseUrl()}/v2/${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
      });
      return await response.json();
    } catch (err) {
      await ApiV2Client.handleApiErrorAsync(err);
    }
  }

  private static async handleApiErrorAsync(err: any): Promise<void> {
    if (err instanceof RequestError) {
      let result: { [key: string]: any };
      try {
        result = (await err.response.json()) as { [key: string]: any };
      } catch {
        throw new Error(`Malformed api response: ${await err.response.text()}`);
      }
      if (result.errors?.length) {
        throw new ApiV2Error(result.errors[0]);
      }
    } else {
      throw err;
    }
  }
}

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
