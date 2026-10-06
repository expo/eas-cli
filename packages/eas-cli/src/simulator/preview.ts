import { stripVTControlCharacters } from 'node:util';
import { Readable } from 'node:stream';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import fetch, { Headers, RequestError, type RequestInit, type Response } from '../fetch';
import { DeviceRunSessionStatus } from '../graphql/generated';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';
import { EAS_SIMULATOR_SESSION_ID, SIMULATOR_DOTENV_FILE_NAME, loadSimulatorEnvAsync } from './env';

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
      `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
    );
  }
  const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId);
  if (session.status !== DeviceRunSessionStatus.InProgress) {
    throw new Error('The simulator session must be running to read its live preview data.');
  }
  const config = session.remoteConfig;
  if (!config?.previewApiUrl) {
    throw new Error('This simulator session does not expose a preview API.');
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(config.previewApiUrl);
  } catch {
    throw new Error('The simulator session has an invalid preview API URL.');
  }
  if (!['https:', 'http:'].includes(baseUrl.protocol)) {
    throw new Error('The simulator session has an invalid preview API URL.');
  }
  const token =
    (config.__typename === 'ServeSimRunSessionRemoteConfig' ||
    config.__typename === 'WebPreviewOnlyRunSessionRemoteConfig'
      ? config.previewToken
      : config.webPreviewToken) ?? baseUrl.searchParams.get('token');
  if (!token) {
    throw new Error('The simulator session does not include a preview API token.');
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
          'The simulator preview is offline. The session may have ended or timed out. Start a new session with `eas simulator:start`.'
        );
      }
      const { status } = error.response;
      if (status === 401 || status === 403) {
        throw new Error('Preview API access was refused. Check the session is still running.');
      }
      if (status === 404) {
        throw new Error(
          'The requested preview data was not found or is not supported by this session.'
        );
      }
      throw new Error(`The preview API request failed (HTTP ${status}).`);
    }
    throw new Error(
      'Could not connect to the simulator preview API. Check the session is still running.'
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
    throw new Error('Could not read the simulator preview API response.');
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
      throw new Error('This simulator session does not support streaming preview data.');
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
      throw new Error('The simulator preview stream ended unexpectedly.');
    }
  } finally {
    controller.abort();
    response?.body.destroy();
    process.removeListener('SIGINT', interrupt);
  }
}

export function sanitizeSimulatorText(value: string): string {
  return stripVTControlCharacters(value).replace(/\p{Cc}/gu, character =>
    character === '\n' || character === '\t' ? character : ''
  );
}
