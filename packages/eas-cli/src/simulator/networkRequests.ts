import { createWriteStream } from 'node:fs';
import { link, lstat, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  type SimulatorPreview,
  type SimulatorPreviewResponse,
  fetchSimulatorPreviewAsync,
  readSimulatorPreviewLinesAsync,
  streamSimulatorPreviewAsync,
} from './preview';

const OUTPUT_EXISTS_MESSAGE = 'The output file already exists. Choose another --output path.';

export type NetworkRequest = {
  _captureId?: string;
  _captureStartedAt?: number | null;
  startedDateTime: string;
  time: number;
  request: { method: string; url: string; bodySize: number; [key: string]: unknown };
  response: { status: number; bodySize: number; [key: string]: unknown };
};

export type NetworkRequestSummary = {
  id: string | null;
  startedAt: number | null;
  startedDateTime: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  requestSize: number;
  responseSize: number;
};

type NetworkCaptureEvent =
  | { type: 'meta'; meta: { attachment: string }; initial?: boolean }
  | { type: 'started' | 'cleared' | 'evicted' }
  | {
      type: 'finished';
      request: {
        id: string;
        startedAt: number;
        method: string;
        url: string;
        status: number | null;
        durationMs: number | null;
        requestBytes: number;
        responseBytes: number;
      };
    };

function compareRequestStarts(a: NetworkRequestSummary, b: NetworkRequestSummary): number {
  return (
    Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime) ||
    (a.startedAt ?? 0) - (b.startedAt ?? 0) ||
    (a.id ?? '').localeCompare(b.id ?? '', undefined, { numeric: true })
  );
}

export async function readNetworkRequestsAsync(
  preview: SimulatorPreview,
  { limit, requestId }: { limit: number; requestId?: string }
): Promise<NetworkRequestSummary[] | NetworkRequest> {
  const controller = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), controller.signal]);
  let response: SimulatorPreviewResponse | undefined;
  const requests: NetworkRequestSummary[] = [];
  let selected: NetworkRequest | undefined;
  const readEntry = (line: string): void => {
    if (!line.trim()) {
      return;
    }
    const entry = JSON.parse(line) as NetworkRequest;
    if (
      !entry.request ||
      !entry.response ||
      typeof entry.startedDateTime !== 'string' ||
      !Number.isFinite(Date.parse(entry.startedDateTime))
    ) {
      throw new Error();
    }
    if (requestId) {
      if (entry._captureId === requestId) {
        selected = entry;
      }
    } else {
      const summary: NetworkRequestSummary = {
        id: entry._captureId ?? null,
        startedAt: entry._captureStartedAt ?? null,
        startedDateTime: entry.startedDateTime,
        method: entry.request.method,
        url: entry.request.url,
        status: entry.response.status,
        duration: entry.time,
        requestSize: entry.request.bodySize,
        responseSize: entry.response.bodySize,
      };
      let index = requests.length;
      while (index > 0 && compareRequestStarts(summary, requests[index - 1]) < 0) {
        index -= 1;
      }
      requests.splice(index, 0, summary);
      if (requests.length > limit) {
        requests.shift();
      }
    }
  };
  try {
    response = await fetchSimulatorPreviewAsync(preview, '/network-capture.ndjson', undefined, {
      signal,
    });
    for await (const line of readSimulatorPreviewLinesAsync(response.body)) {
      readEntry(line);
    }
  } catch (error) {
    if (signal.aborted) {
      throw new Error('The network capture request timed out.');
    }
    if (!response) {
      throw error;
    }
    throw new Error('Could not read the network capture.');
  } finally {
    controller.abort();
    response?.body.destroy();
  }
  if (!requestId) {
    return requests;
  }
  if (!selected) {
    throw new Error('That request was not found in the current network capture.');
  }
  return selected;
}

export async function streamNetworkRequestsAsync(
  preview: SimulatorPreview,
  onRequest: (request: NetworkRequestSummary) => void
): Promise<void> {
  let streamError: Error | undefined;
  try {
    await streamSimulatorPreviewAsync(preview, '/network-capture', data => {
      try {
        const event = JSON.parse(data) as NetworkCaptureEvent;
        if (event.type === 'meta') {
          if (event.meta.attachment === 'not-enabled') {
            streamError = new Error(
              event.initial
                ? 'Network capture is not enabled for this session. Start the session with --network-capture.'
                : 'Network capture was turned off.'
            );
            throw streamError;
          }
          if (event.meta.attachment === 'failed') {
            streamError = new Error(
              'The network capture failed. Check the session preview for details.'
            );
            throw streamError;
          }
        } else if (event.type === 'finished') {
          const request = event.request;
          if (
            !request ||
            typeof request.id !== 'string' ||
            typeof request.method !== 'string' ||
            typeof request.url !== 'string' ||
            !Number.isFinite(request.startedAt) ||
            !Number.isFinite(request.requestBytes) ||
            !Number.isFinite(request.responseBytes) ||
            (request.status !== null && !Number.isFinite(request.status)) ||
            (request.durationMs !== null && !Number.isFinite(request.durationMs))
          ) {
            throw new Error();
          }
          onRequest({
            id: request.id,
            startedAt: request.startedAt,
            startedDateTime: new Date(request.startedAt).toISOString(),
            method: request.method,
            url: request.url,
            status: request.status ?? 0,
            duration: Math.max(0, request.durationMs ?? 0),
            requestSize: request.requestBytes,
            responseSize: request.responseBytes,
          });
        }
      } catch {
        streamError ??= new Error('Could not read the network capture stream.');
        throw streamError;
      }
    });
  } catch (error) {
    throw streamError ?? error;
  }
}

export async function downloadNetworkCaptureAsync(
  preview: SimulatorPreview,
  output: string
): Promise<string> {
  const outputPath = path.resolve(output);
  const outputExists = await lstat(outputPath).then(
    () => true,
    error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw new Error('Could not access the output path. Check the --output directory.');
    }
  );
  if (outputExists) {
    throw new Error(OUTPUT_EXISTS_MESSAGE);
  }
  let directory: string;
  try {
    directory = await mkdtemp(path.join(path.dirname(outputPath), '.eas-network-capture-'));
  } catch {
    throw new Error(
      'Could not create the output file. Check the --output directory exists and is writable.'
    );
  }
  const temporaryPath = path.join(directory, 'capture.har');
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort('timed-out');
  }, 10 * 60_000);
  const interrupt = (): void => {
    controller.abort('interrupted');
  };
  process.on('SIGINT', interrupt);
  let response: SimulatorPreviewResponse | undefined;
  try {
    response = await fetchSimulatorPreviewAsync(preview, '/network-capture.har', undefined, {
      signal: controller.signal,
    });
    await pipeline(response.body, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }), {
      signal: controller.signal,
    });
    await link(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        controller.signal.reason === 'interrupted'
          ? 'The network capture download was interrupted.'
          : 'The network capture download timed out.'
      );
    }
    if (!response) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(OUTPUT_EXISTS_MESSAGE);
    }
    throw new Error('Could not save the network capture. Check the session and output directory.');
  } finally {
    clearTimeout(timeout);
    process.removeListener('SIGINT', interrupt);
    controller.abort();
    response?.body.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}
