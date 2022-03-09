import { Agent } from 'https';
import createHttpsProxyAgent from 'https-proxy-agent';
import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch';

export * from 'node-fetch';

export class RequestError extends Error {
  constructor(message: string, public readonly response: Response) {
    super(message);
  }
}

function createHttpAgent(): Agent | null {
  const httpProxyUrl = process.env.http_proxy;
  if (!httpProxyUrl) {
    return null;
  }
  return createHttpsProxyAgent(httpProxyUrl);
}

export const maybeHttpAgent: Agent | null = createHttpAgent();

export default async function (url: RequestInfo, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status >= 400) {
    throw new RequestError(`Request failed: ${response.status} (${response.statusText})`, response);
  }
  return response;
}
