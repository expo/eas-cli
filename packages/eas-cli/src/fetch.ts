import { env } from 'node:process';
import { EnvHttpProxyAgent, fetch } from 'undici';

export {
  Agent,
  Dispatcher,
  FormData,
  Headers,
  HeadersInit,
  Request,
  RequestInit,
  Response,
  ResponseInit,
} from 'undici';

/**
 * Create a proxy agent when `http_proxy`, `https_proxy`, or uppercase equivalents environment variables are defined.
 * This agent is built-in with Undici and can be used as global or per-fetch dispatchers.
 */
function createProxyAgent(): EnvHttpProxyAgent | null {
  // See: https://github.com/nodejs/undici/blob/v6.21.1/docs/docs/api/EnvHttpProxyAgent.md
  const httpProxy = env.http_proxy ?? env.HTTP_PROXY;
  const httpsProxy = env.https_proxy ?? env.HTTPS_PROXY;

  return httpProxy || httpsProxy ? new EnvHttpProxyAgent({ httpProxy, httpsProxy }) : null;
}

export const sharedProxyAgent = createProxyAgent();

/**
 * Wrap the `fetch` method and throw a `RequestError` whenever response status `>=400` are encountered.
 * Normally, fetch does not throw on response errors.
 */
function wrapFetchWithRequestError(fetchRef: typeof fetch): typeof fetch {
  return async (url, init = {}) => {
    if (sharedProxyAgent && !init.dispatcher) {
      init.dispatcher = sharedProxyAgent;
    }

    const response = await fetchRef(url, init);
    if (response.status >= 400) {
      throw new RequestError(
        `Request failed: ${response.status} (${response.statusText})`,
        response
      );
    }

    return response;
  };
}

export default wrapFetchWithRequestError(fetch);

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly response: Response
  ) {
    super(message);
  }
}
