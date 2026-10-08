import fs from 'fs-extra';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';

import {
  type SimulatorPreview,
  fetchSimulatorPreviewAsync,
  streamSimulatorPreviewAsync,
} from './preview';
import { type Response } from '../fetch';

const NETWORK_CAPTURE_TIMEOUT_MS = 10 * 60_000;
const NETWORK_CAPTURE_NOT_ENABLED_MESSAGE =
  'Network capture is not enabled for this session. Capture must be requested when the session starts. Start a new session with `eas simulator:start --network-capture`.';
const OUTPUT_EXISTS_MESSAGE =
  'The output file already exists. The command does not overwrite files. Choose another --output path.';
const INVALID_NETWORK_CAPTURE_MESSAGE =
  'Could not read the network capture. The capture data was incomplete or not in the expected format. Try again. If this keeps happening, update EAS CLI.';

const networkRequestSchema = z.looseObject({
  _captureId: z.string().optional(),
  _captureStartedAt: z.number().nullable().optional(),
  startedDateTime: z.string().refine(value => Number.isFinite(Date.parse(value))),
  time: z.number(),
  request: z.looseObject({ method: z.string(), url: z.string(), bodySize: z.number() }),
  response: z.looseObject({ status: z.number(), bodySize: z.number() }),
});
const networkCaptureEventSchema = z.union([
  z.object({
    type: z.literal('meta'),
    initial: z.boolean().optional(),
    meta: z.object({ attachment: z.string().optional() }),
  }),
  z.object({
    type: z.literal('finished'),
    request: z.object({
      id: z.string(),
      startedAt: z.number(),
      method: z.string(),
      url: z.string(),
      status: z.number().nullable(),
      durationMs: z.number().nullable(),
      requestBytes: z.number(),
      responseBytes: z.number(),
    }),
  }),
  // Other events, such as `started` and `cleared`, have nothing to print.
  z.object({ type: z.string().refine(type => type !== 'meta' && type !== 'finished') }),
]);

export type NetworkRequest = z.infer<typeof networkRequestSchema>;

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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

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
  const signal = AbortSignal.timeout(NETWORK_CAPTURE_TIMEOUT_MS);
  let response: Response | undefined;
  const requests: NetworkRequestSummary[] = [];
  let selected: NetworkRequest | undefined;
  try {
    response = await fetchSimulatorPreviewAsync(preview, '/network-capture.ndjson', {
      signal,
      notFoundMessage: NETWORK_CAPTURE_NOT_ENABLED_MESSAGE,
    });
    for await (const line of readline.createInterface({
      input: response.body,
      crlfDelay: Infinity,
    })) {
      if (!line.trim()) {
        continue;
      }
      const result = networkRequestSchema.safeParse(parseJson(line));
      if (!result.success) {
        throw new Error(INVALID_NETWORK_CAPTURE_MESSAGE);
      }
      const entry = result.data;
      if (requestId) {
        if (entry._captureId === requestId) {
          selected = entry;
        }
        continue;
      }
      requests.push({
        id: entry._captureId ?? null,
        startedAt: entry._captureStartedAt ?? null,
        startedDateTime: entry.startedDateTime,
        method: entry.request.method,
        url: entry.request.url,
        status: entry.response.status,
        duration: entry.time,
        requestSize: entry.request.bodySize,
        responseSize: entry.response.bodySize,
      });
    }
  } catch (error) {
    if (signal.aborted) {
      throw new Error(
        'The network capture request timed out. The capture did not download within 10 minutes. Run `eas simulator:get` to check that the session is still running, then try again.'
      );
    }
    if (!response) {
      throw error;
    }
    throw new Error(INVALID_NETWORK_CAPTURE_MESSAGE);
  }
  if (!requestId) {
    return requests.sort(compareRequestStarts).slice(-limit);
  }
  if (!selected) {
    throw new Error(
      'The request was not found in the network capture. The ID does not match a completed request in the current capture. Run `eas simulator:network-requests` to see current request IDs.'
    );
  }
  return selected;
}

export async function streamNetworkRequestsAsync(
  preview: SimulatorPreview,
  onRequest: (request: NetworkRequestSummary) => void,
  signal: AbortSignal
): Promise<void> {
  await streamSimulatorPreviewAsync(
    preview,
    '/network-capture',
    data => {
      const result = networkCaptureEventSchema.safeParse(parseJson(data));
      if (!result.success) {
        throw new Error(
          'Could not read the network capture stream. An event from the session was not in the expected format. Run the command again. If this keeps happening, update EAS CLI.'
        );
      }
      const event = result.data;
      if ('meta' in event) {
        if (event.meta.attachment === 'not-enabled') {
          throw new Error(
            event.initial
              ? NETWORK_CAPTURE_NOT_ENABLED_MESSAGE
              : 'Network capture was turned off, so the session no longer records requests. Start a new session with `eas simulator:start --network-capture` to capture again.'
          );
        }
        if (event.meta.attachment === 'failed') {
          throw new Error(
            'The network capture failed. The session reported a capture error. Open the session preview to see the error, or start a new session with `eas simulator:start --network-capture`.'
          );
        }
      } else if ('request' in event) {
        const { request } = event;
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
    },
    { signal, notFoundMessage: NETWORK_CAPTURE_NOT_ENABLED_MESSAGE }
  );
}

export async function downloadNetworkCaptureAsync(
  preview: SimulatorPreview,
  output: string
): Promise<string> {
  const outputPath = path.resolve(output);
  if (await fs.pathExists(outputPath)) {
    throw new Error(OUTPUT_EXISTS_MESSAGE);
  }
  const signal = AbortSignal.timeout(NETWORK_CAPTURE_TIMEOUT_MS);
  let response: Response | undefined;
  // Only remove a file this command opened. Another process may create the path after the check.
  let created = false;
  try {
    response = await fetchSimulatorPreviewAsync(preview, '/network-capture.har', {
      signal,
      notFoundMessage: NETWORK_CAPTURE_NOT_ENABLED_MESSAGE,
    });
    // The HAR contains decrypted request data, such as credentials, so only the user can read it.
    const file = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
    file.once('open', () => {
      created = true;
    });
    await pipeline(response.body, file);
  } catch (error) {
    if (created) {
      await fs.remove(outputPath);
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(OUTPUT_EXISTS_MESSAGE);
    }
    if (signal.aborted) {
      throw new Error(
        'The network capture download timed out. It did not finish within 10 minutes. Check your internet connection, then run the command again.'
      );
    }
    if (!response) {
      throw error;
    }
    throw new Error(
      'Could not save the network capture. The download or the file write failed. Check that the --output directory exists and is writable. Run `eas simulator:get` to check that the session is still running, then try again.'
    );
  }
  return outputPath;
}
