import { stripVTControlCharacters } from 'node:util';
import { Readable } from 'node:stream';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import fetch, { Headers, RequestError, type RequestInit, type Response } from '../fetch';
import { DeviceRunSessionStatus } from '../graphql/generated';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';
import { EAS_SIMULATOR_SESSION_ID, SIMULATOR_DOTENV_FILE_NAME, loadSimulatorEnvAsync } from './env';

const INVALID_PREVIEW_API_URL_MESSAGE =
  'The simulator session has an invalid preview API URL. The session reported a URL that is not a valid HTTP(S) URL. Start a new session with `eas simulator:start`. If this keeps happening, contact us at https://expo.dev/contact.';
const PREVIEW_DATA_NOT_FOUND_MESSAGE =
  "The requested preview data was not found. The session's preview server does not support this request. Start a new session with `eas simulator:start`, then try again.";

export type SimulatorPreview = {
  deviceRunSessionId: string;
  baseUrl: URL;
  token: string;
};

export type SimulatorPreviewResponse = Response & { body: Readable };

export async function resolveSimulatorPreviewAsync(
  graphqlClient: ExpoGraphqlClient,
  projectDir: string,
  id?: string
): Promise<SimulatorPreview> {
  await loadSimulatorEnvAsync(projectDir);
  const deviceRunSessionId = id ?? process.env[EAS_SIMULATOR_SESSION_ID];
  if (!deviceRunSessionId) {
    throw new Error(
      `No simulator session ID was found. The command reads it from --id or from ${SIMULATOR_DOTENV_FILE_NAME}, and neither was set. Pass --id, or run \`eas simulator:start\` to start a session.`
    );
  }
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
  const token =
    (config.__typename === 'ServeSimRunSessionRemoteConfig' ||
    config.__typename === 'WebPreviewOnlyRunSessionRemoteConfig'
      ? config.previewToken
      : config.webPreviewToken) ?? baseUrl.searchParams.get('token');
  if (!token) {
    throw new Error(
      'The simulator session does not include a preview API token. The preview API requires a token, and the session did not report one. Start a new session with `eas simulator:start`. If this keeps happening, contact us at https://expo.dev/contact.'
    );
  }
  baseUrl.searchParams.delete('token');
  baseUrl.hash = '';
  return { deviceRunSessionId, baseUrl, token };
}

export async function fetchSimulatorPreviewAsync(
  preview: SimulatorPreview,
  route: string,
  query?: Record<string, string>,
  init?: RequestInit
): Promise<SimulatorPreviewResponse> {
  const url = new URL(preview.baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${route}`;
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${preview.token}`);
  try {
    return (await fetch(url.toString(), {
      timeout: 30_000,
      redirect: 'error',
      ...init,
      headers,
    })) as SimulatorPreviewResponse;
  } catch (error) {
    if (init?.signal?.aborted) {
      throw error;
    }
    if (error instanceof RequestError) {
      (error.response.body as Readable).destroy();
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
        throw new Error(PREVIEW_DATA_NOT_FOUND_MESSAGE);
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
  query?: Record<string, string>
): Promise<T> {
  const controller = new AbortController();
  let response: SimulatorPreviewResponse | undefined;
  try {
    response = await fetchSimulatorPreviewAsync(preview, route, query, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    return await response.json();
  } catch (error) {
    if (!response) {
      throw error;
    }
    throw new Error(
      'Could not read the simulator preview API response. The response was incomplete or not valid JSON. Try again. If this keeps happening, update EAS CLI.'
    );
  } finally {
    controller.abort();
    response?.body.destroy();
  }
}

async function* readSimulatorPreviewLinesAsync(body: Readable): AsyncGenerator<string> {
  body.setEncoding('utf8');
  let buffered = '';
  for await (const chunk of body) {
    buffered += chunk;
    let newline: number;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      yield buffered.slice(0, newline).replace(/\r$/, '');
      buffered = buffered.slice(newline + 1);
    }
  }
  if (buffered) {
    yield buffered.replace(/\r$/, '');
  }
}

export async function streamSimulatorPreviewAsync(
  preview: SimulatorPreview,
  route: string,
  onData: (data: string) => void,
  query?: Record<string, string>
): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => {
    controller.abort();
  };
  process.on('SIGINT', interrupt);
  let response: SimulatorPreviewResponse | undefined;
  let reading = false;
  try {
    response = await fetchSimulatorPreviewAsync(preview, route, query, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error(
        'This simulator session does not support streaming. Its preview server did not return an event stream. Run the command without --follow.'
      );
    }
    reading = true;
    let data: string[] = [];
    for await (const line of readSimulatorPreviewLinesAsync(response.body)) {
      if (line === '') {
        if (data.length > 0) {
          onData(data.join('\n'));
          data = [];
        }
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      if (!reading) {
        throw error;
      }
      throw new Error(
        "The simulator preview stream ended unexpectedly. The connection to the session's preview server closed. Run `eas simulator:get` to check that the session is still running, then run the command again."
      );
    }
  } finally {
    controller.abort();
    response?.body.destroy();
    process.removeListener('SIGINT', interrupt);
  }
}

// Session text is untrusted, so strip terminal escape and control characters before printing it.
export function sanitizeSimulatorText(value: string): string {
  return stripVTControlCharacters(value).replace(/\p{Cc}/gu, character =>
    character === '\n' || character === '\t' ? character : ''
  );
}
