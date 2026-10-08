import readline from 'node:readline';

import { getPreviewToken } from './utils';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import fetch, { RequestError, type Response } from '../fetch';
import { DeviceRunSessionStatus } from '../graphql/generated';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';

const PREVIEW_API_TIMEOUT_MS = 30_000;
// The preview server sends a heartbeat every 15 seconds, so a longer silence means the stream is gone.
const PREVIEW_STREAM_IDLE_TIMEOUT_MS = 60_000;
const INVALID_PREVIEW_API_URL_MESSAGE =
  'The simulator session has an invalid preview API URL. The session reported a URL that is not a valid HTTP(S) URL. Start a new session with `eas simulator:start`.';
const PREVIEW_DATA_NOT_FOUND_MESSAGE =
  "The requested preview data was not found. The session's preview server does not support this request. Start a new session with `eas simulator:start`, then try again.";

export type SimulatorPreview = {
  deviceRunSessionId: string;
  baseUrl: URL;
  token: string;
};

type SimulatorPreviewRequestOptions = {
  query?: Record<string, string>;
  signal?: AbortSignal;
  /** Message for a 404 response. Defaults to a generic message for unsupported preview data. */
  notFoundMessage?: string;
};

export async function resolveSimulatorPreviewAsync(
  graphqlClient: ExpoGraphqlClient,
  deviceRunSessionId: string
): Promise<SimulatorPreview> {
  const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId);
  if (session.status !== DeviceRunSessionStatus.InProgress) {
    throw new Error(
      'The simulator session is not running. Live preview data is only available while a session runs. Start a new session with `eas simulator:start`.'
    );
  }
  const config = session.remoteConfig;
  if (!config?.previewApiUrl) {
    throw new Error(
      'This simulator session does not expose a preview API. The command reads live data through the preview API, and the session did not report one. Start a new iOS session with `eas simulator:start --platform ios`.'
    );
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(config.previewApiUrl);
  } catch {
    throw new Error(INVALID_PREVIEW_API_URL_MESSAGE);
  }
  if (!['https:', 'http:'].includes(baseUrl.protocol)) {
    throw new Error(INVALID_PREVIEW_API_URL_MESSAGE);
  }
  const token = getPreviewToken(config);
  if (!token) {
    throw new Error(
      'The simulator session does not include a preview API token. The preview API requires a token, and the session did not report one. Start a new session with `eas simulator:start`.'
    );
  }
  // Requests send the token in a header, so keep it out of URLs that can appear in errors.
  baseUrl.searchParams.delete('token');
  baseUrl.hash = '';
  return { deviceRunSessionId, baseUrl, token };
}

export async function fetchSimulatorPreviewAsync(
  preview: SimulatorPreview,
  route: string,
  {
    query,
    signal,
    notFoundMessage = PREVIEW_DATA_NOT_FOUND_MESSAGE,
    accept,
  }: SimulatorPreviewRequestOptions & { accept?: string } = {}
): Promise<Response> {
  const url = new URL(route, preview.baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  try {
    return await fetch(url.toString(), {
      timeout: PREVIEW_API_TIMEOUT_MS,
      signal,
      headers: {
        Authorization: `Bearer ${preview.token}`,
        ...(accept ? { Accept: accept } : {}),
      },
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    if (error instanceof RequestError) {
      if (error.response.headers.get('ngrok-error-code') === 'ERR_NGROK_3200') {
        throw new Error(
          'The simulator preview is offline. The session may have stopped or reached its time limit. Start a new session with `eas simulator:start`.'
        );
      }
      const { status } = error.response;
      if (status === 401 || status === 403) {
        throw new Error(
          "The preview API refused access. It did not accept the session's preview token. Run `eas simulator:get` to check that the session is still running, then try again."
        );
      }
      if (status === 404) {
        throw new Error(notFoundMessage);
      }
      throw new Error(
        `The preview API request failed (HTTP ${status}). The session's preview server returned an error. Run \`eas simulator:get\` to check that the session is still running, then try again.`
      );
    }
    throw new Error(
      "Could not connect to the simulator preview API. The request did not reach the session's preview server. Check your internet connection. Run `eas simulator:get` to check that the session is still running."
    );
  }
}

export async function fetchSimulatorPreviewJsonAsync<T>(
  preview: SimulatorPreview,
  route: string,
  options: Omit<SimulatorPreviewRequestOptions, 'signal'> = {}
): Promise<T> {
  const response = await fetchSimulatorPreviewAsync(preview, route, {
    ...options,
    accept: 'application/json',
  });
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(
      'Could not read the simulator preview API response. The response was incomplete or not valid JSON. Try again.'
    );
  }
}

/**
 * Calls `onData` with each server-sent event's data until the stream ends or `signal` aborts.
 * Errors thrown by `onData` stop the stream and are rethrown unchanged.
 */
export async function streamSimulatorPreviewAsync(
  preview: SimulatorPreview,
  route: string,
  onData: (data: string) => void,
  { signal, ...options }: SimulatorPreviewRequestOptions & { signal: AbortSignal }
): Promise<void> {
  // Aborting closes the connection, including when the stream stops because of an error.
  const controller = new AbortController();
  let reading = false;
  let onDataError: unknown;
  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdleTimer = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      controller.abort();
    }, PREVIEW_STREAM_IDLE_TIMEOUT_MS);
  };
  try {
    const response = await fetchSimulatorPreviewAsync(preview, route, {
      ...options,
      signal: AbortSignal.any([signal, controller.signal]),
      accept: 'text/event-stream',
    });
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error(
        'This simulator session does not support streaming. Its preview server did not return an event stream. Run the command without --follow.'
      );
    }
    reading = true;
    resetIdleTimer();
    let data: string[] = [];
    for await (const line of readline.createInterface({
      input: response.body,
      crlfDelay: Infinity,
    })) {
      resetIdleTimer();
      if (line === '' && data.length > 0) {
        const frame = data.join('\n');
        data = [];
        try {
          onData(frame);
        } catch (error) {
          onDataError = error;
          throw error;
        }
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    if (!reading || error === onDataError) {
      throw error;
    }
    throw new Error(
      "The simulator preview stream ended unexpectedly. The connection to the session's preview server closed. Run `eas simulator:get` to check that the session is still running, then run the command again."
    );
  } finally {
    clearTimeout(idleTimer);
    controller.abort();
  }
}
