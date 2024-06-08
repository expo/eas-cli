import { env } from 'node:process';
import {
  ProxyAgent,
  type RequestInfo,
  type RequestInit,
  type Response,
  fetch,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici';

export { Agent, Headers, type RequestInfo, type RequestInit, Response } from 'undici';

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly response: Response
  ) {
    super(message);
  }
}

export default async function (url: RequestInfo, init?: RequestInit): Promise<Response> {
  installProxyAgent();

  const response = await fetch(url, init);
  if (response.status >= 400) {
    throw new RequestError(`Request failed: ${response.status} (${response.statusText})`, response);
  }

  return response;
}

function installProxyAgent(): void {
  const httpsProxyUrl = env.https_proxy;

  if (httpsProxyUrl && !(getGlobalDispatcher() instanceof ProxyAgent)) {
    setGlobalDispatcher(new ProxyAgent(httpsProxyUrl));
  }
}
