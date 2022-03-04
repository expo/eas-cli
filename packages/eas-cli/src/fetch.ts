import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch';

export * from 'node-fetch';

export default async function (url: RequestInfo, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status >= 400) {
    const error = new Error(`Request failed: ${response.status} (${response.statusText})`);
    (error as any).response = response;
    throw error;
  }
  return response;
}
