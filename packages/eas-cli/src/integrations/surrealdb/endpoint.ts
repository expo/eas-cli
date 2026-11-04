import fetch from '../../fetch';
import Log from '../../log';

// SurrealDB Studio (formerly Surrealist) connects to any instance, including SurrealDB Cloud ones,
// so it is the dashboard for every endpoint.
export const SURREAL_STUDIO_URL = 'https://studio.surrealdb.com';
export const SURREAL_EXPO_GUIDE_URL =
  'https://surrealdb.com/docs/reference/javascript/frameworks/expo';

const SUPPORTED_PROTOCOLS = new Set(['ws:', 'wss:', 'http:', 'https:']);
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Normalize what a user pastes (a SurrealDB Cloud hostname, a `wss://…/rpc` URL, a local address)
 * into the endpoint the JavaScript SDK takes. A bare hostname gets `wss://`.
 */
export function parseSurrealEndpoint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Pass a SurrealDB endpoint, e.g. wss://my-instance.aws-euw1.surreal.cloud');
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error(`"${trimmed}" is not a valid SurrealDB endpoint URL.`);
  }
  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `Unsupported protocol "${url.protocol}" in "${trimmed}". Use wss://, https://, ws:// or http://.`
    );
  }
  if (url.username || url.password) {
    throw new Error(
      'Do not put credentials in the endpoint. It ships in the app bundle; sign users in with record access instead.'
    );
  }
  if (url.search || url.hash) {
    throw new Error(`Remove the query string or fragment from "${trimmed}".`);
  }
  // The SDK appends /rpc itself, so a pasted RPC URL would end up as /rpc/rpc.
  const pathname = url.pathname.replace(/\/rpc\/?$/, '').replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${pathname}`;
}

export function validateSurrealEndpoint(value: string): true | string {
  try {
    parseSurrealEndpoint(value);
    return true;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid SurrealDB endpoint';
  }
}

export function isCleartextEndpoint(endpoint: string): boolean {
  const { protocol } = new URL(endpoint);
  return protocol === 'ws:' || protocol === 'http:';
}

export function getSurrealHealthUrl(endpoint: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === 'wss:' || url.protocol === 'https:' ? 'https:' : 'http:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/health`;
  return url.toString();
}

/**
 * Best effort: a development endpoint such as 10.0.2.2 is reachable from the emulator but not from
 * this machine, so a failed check is a warning, never an error.
 */
export async function isSurrealEndpointReachableAsync(endpoint: string): Promise<boolean> {
  try {
    await fetch(getSurrealHealthUrl(endpoint), {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return true;
  } catch (error) {
    Log.debug(`SurrealDB health check failed for ${endpoint}: ${error}`);
    return false;
  }
}

export function validateSurrealName(kind: 'namespace' | 'database') {
  return (value: string): true | string =>
    value.trim() ? true : `Enter the SurrealDB ${kind} the app should use.`;
}
