import fs from 'fs-extra';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import fetch, { Response } from '../../fetch';
import { DeviceRunSessionStatus } from '../../graphql/generated';
import Log from '../../log';
import { promptAsync, selectAsync } from '../../prompts';
import { printJsonOnlyOutput } from '../../utils/json';
import {
  type SimulatorSession,
  downloadSimulatorArtifactAsync,
  hasSimulatorArtifacts,
} from '../artifacts';
import { downloadSimulatorFileAsync } from '../download';

jest.mock('../../fetch');
jest.mock('../../log');
jest.mock('../../ora', () => ({
  ora: () => ({ start: () => ({ succeed: jest.fn(), fail: jest.fn() }) }),
}));
jest.mock('../../prompts');
jest.mock('../../utils/json');
jest.mock('../download');

function artifact(
  id: string,
  type = 'simulator-log',
  createdAt = '2026-10-07T12:00:00Z'
): SimulatorSession['artifacts'][number] {
  return {
    id,
    name: `Log ${id}`,
    filename: `${id}.ndjson`,
    downloadUrl: `https://storage.test/${id}?token=secret`,
    createdAt,
    updatedAt: createdAt,
    fileSizeBytes: 100,
    metadata: { __eas_type: type, udid: 'SIM-A', part: 2 },
  };
}

const first = artifact('a');
function session(artifacts = [first]): SimulatorSession {
  return {
    id: 'session-id',
    status: DeviceRunSessionStatus.Stopped,
    artifacts,
  } as SimulatorSession;
}

const options = { output: 'logs.ndjson', nonInteractive: true, json: false };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(downloadSimulatorFileAsync).mockResolvedValue('/logs.ndjson');
});

it.each([DeviceRunSessionStatus.Stopped, DeviceRunSessionStatus.Errored])(
  'uses artifacts for %s',
  status => {
    expect(hasSimulatorArtifacts({ ...session(), status })).toBe(true);
  }
);

it.each([
  DeviceRunSessionStatus.InProgress,
  DeviceRunSessionStatus.Queued,
  DeviceRunSessionStatus.Starting,
])('does not use artifacts for %s', status => {
  expect(hasSimulatorArtifacts({ ...session(), status })).toBe(false);
});

it('reports missing artifacts without contacting storage', async () => {
  await expect(
    downloadSimulatorArtifactAsync(
      session([artifact('a', 'session-events')]),
      'simulator-log',
      options
    )
  ).rejects.toThrow('No matching artifacts');
  expect(downloadSimulatorFileAsync).not.toHaveBeenCalled();
});

it('automatically selects one artifact and prints its saved path', async () => {
  await downloadSimulatorArtifactAsync(session(), 'simulator-log', options);
  expect(downloadSimulatorFileAsync).toHaveBeenCalledWith('logs.ndjson', expect.any(Function));
  expect(Log.log).toHaveBeenCalledWith('Saved Log a to /logs.ndjson.');
  expect(selectAsync).not.toHaveBeenCalled();
});

it('sorts available indexes, sanitizes labels, and requires explicit selection noninteractively', async () => {
  const older = {
    ...artifact('b', 'simulator-log', '2026-10-07T11:00:00Z'),
    name: '\u001b[31mEarlier\u001b[0m\u0007',
  };
  await expect(
    downloadSimulatorArtifactAsync(session([first, older]), 'simulator-log', options)
  ).rejects.toThrow(
    '1. Earlier — b.ndjson (100 B) (SIM-A) (part 2)\n2. Log a — a.ndjson (100 B) (SIM-A) (part 2)'
  );
  expect(downloadSimulatorFileAsync).not.toHaveBeenCalled();
});

it.each([0, -1, 3, 1.5])('rejects invalid index %s and lists indexes', async index => {
  await expect(
    downloadSimulatorArtifactAsync(session([first, artifact('b')]), 'simulator-log', {
      ...options,
      artifact: index,
    })
  ).rejects.toThrow('out of range. Choose an artifact with --artifact');
  expect(downloadSimulatorFileAsync).not.toHaveBeenCalled();
});

it('uses the explicit 1-based index and returns metadata without storage credentials', async () => {
  const second = artifact('b');
  await downloadSimulatorArtifactAsync(session([second, first]), 'simulator-log', {
    ...options,
    artifact: 2,
    json: true,
  });
  expect(printJsonOnlyOutput).toHaveBeenCalledWith({
    deviceRunSessionId: 'session-id',
    artifact: {
      id: second.id,
      name: second.name,
      filename: second.filename,
      metadata: second.metadata,
    },
    filePath: '/logs.ndjson',
  });
  expect(Log.log).not.toHaveBeenCalled();
  expect(JSON.stringify(jest.mocked(printJsonOnlyOutput).mock.calls)).not.toContain('secret');
});

it('prompts for a selection and destination with a basename default', async () => {
  jest.mocked(selectAsync).mockResolvedValue(2);
  jest.mocked(promptAsync).mockResolvedValue({ filePath: 'chosen.ndjson' });
  await downloadSimulatorArtifactAsync(
    session([first, { ...artifact('b'), filename: '../saved.ndjson' }]),
    'simulator-log',
    { nonInteractive: false, json: false }
  );
  expect(selectAsync).toHaveBeenCalledWith('Select an artifact to download:', [
    { title: '1. Log a — a.ndjson (100 B) (SIM-A) (part 2)', value: 1 },
    { title: '2. Log b — ../saved.ndjson (100 B) (SIM-A) (part 2)', value: 2 },
  ]);
  expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ initial: 'saved.ndjson' }));
  expect(downloadSimulatorFileAsync).toHaveBeenCalledWith('chosen.ndjson', expect.any(Function));
});

it('requires output without prompting in noninteractive mode', async () => {
  await expect(
    downloadSimulatorArtifactAsync(session(), 'simulator-log', { nonInteractive: true, json: true })
  ).rejects.toThrow('Pass --output');
  expect(promptAsync).not.toHaveBeenCalled();
  expect(downloadSimulatorFileAsync).not.toHaveBeenCalled();
});

it('downloads from storage without a preview bearer or redirect restrictions', async () => {
  const response = new Response(Readable.from(['logs']));
  jest.mocked(fetch).mockResolvedValue(response);
  jest.mocked(downloadSimulatorFileAsync).mockImplementation(async (_output, getResponse) => {
    await expect(getResponse(new AbortController().signal)).resolves.toBe(response);
    return '/logs.ndjson';
  });
  await downloadSimulatorArtifactAsync(session(), 'simulator-log', options);
  expect(fetch).toHaveBeenCalledWith(first.downloadUrl, {
    signal: expect.any(AbortSignal),
    timeout: 30_000,
  });
});

it('redacts signed URLs from storage failures', async () => {
  jest.mocked(fetch).mockRejectedValue(new Error(first.downloadUrl));
  jest.mocked(downloadSimulatorFileAsync).mockImplementation(async (_output, getResponse) => {
    await getResponse(new AbortController().signal);
    return '/logs.ndjson';
  });
  const downloading = downloadSimulatorArtifactAsync(session(), 'simulator-log', options);
  await expect(downloading).rejects.toThrow('Could not download the session artifact');
  await expect(downloading).rejects.not.toThrow('secret');
});

it('closes an unfinished HTTP error response without exposing storage credentials', async () => {
  const actualFetch = jest.requireActual<typeof import('../../fetch')>('../../fetch').default;
  const actualDownload = jest.requireActual<typeof import('../download')>('../download');
  jest.mocked(fetch).mockImplementation(actualFetch);
  jest
    .mocked(downloadSimulatorFileAsync)
    .mockImplementation(actualDownload.downloadSimulatorFileAsync);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sim-artifact-error-'));
  let markClosed = (): void => {};
  const closed = new Promise<void>(resolve => {
    markClosed = resolve;
  });
  const server = createServer((_request, response) => {
    response.once('close', markClosed);
    response.writeHead(403);
    response.write('secret storage token');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const failedArtifact = {
    ...first,
    downloadUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/?token=secret`,
  };
  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    server.closeAllConnections();
  }, 2_000);
  try {
    const downloading = downloadSimulatorArtifactAsync(session([failedArtifact]), 'simulator-log', {
      ...options,
      output: path.join(directory, 'logs.ndjson'),
    });
    await expect(downloading).rejects.toThrow('Could not download the session artifact');
    await expect(downloading).rejects.not.toThrow('secret');
    await closed;
    expect(expired).toBe(false);
    expect(await fs.readdir(directory)).toEqual([]);
  } finally {
    clearTimeout(deadline);
    server.closeAllConnections();
    await new Promise<void>(resolve =>
      server.close(() => {
        resolve();
      })
    );
    await fs.remove(directory);
  }
});
