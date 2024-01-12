import { Agent } from 'https';
import createHttpsProxyAgent from 'https-proxy-agent';
import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch';

export * from 'node-fetch';

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly response: Response
  ) {
    super(message);
  }
}

function createHttpsAgent(): Agent | null {
  const httpsProxyUrl = process.env.https_proxy;
  if (!httpsProxyUrl) {
    return null;
  }
  return createHttpsProxyAgent(httpsProxyUrl);
}

export const httpsProxyAgent: Agent | null = createHttpsAgent();

export default async function (url: RequestInfo, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    ...(httpsProxyAgent ? { agent: httpsProxyAgent } : {}),
  });
  if (response.status >= 400) {
    throw new RequestError(`Request failed: ${response.status} (${response.statusText})`, response);
  }
  return response;
}
