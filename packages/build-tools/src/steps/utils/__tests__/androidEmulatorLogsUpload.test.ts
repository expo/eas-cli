import { type BuildStepGlobalContext } from '@expo/steps';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { type CustomBuildContext } from '../../../customBuildContext';
import {
  collectAndroidEmulatorLogsAsync,
  registerAndroidEmulatorLogDirectory,
} from '../androidEmulatorLogs';
import { requireDeviceRunSessionWorkerApi } from '../deviceRunSessionWorkerApi';

jest.mock('../deviceRunSessionWorkerApi');
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.unmock('node-fetch');

it('retries a capped log after an early storage error with real file streams and one artifact', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'android-log-upload-test-'));
  const maximumBytes = 20 * 1024 * 1024;
  const payload = Buffer.alloc(maximumBytes + 6, 'a');
  await writeFile(path.join(directory, 'device-emulator.log'), payload);
  const global = {} as BuildStepGlobalContext;
  const logger = createMockLogger();
  registerAndroidEmulatorLogDirectory(global, directory);
  let requests = 0;
  let receivedBytes = 0;
  const server = createServer((request, response) => {
    requests++;
    if (requests === 1) {
      response.statusCode = 503;
      response.flushHeaders();
      return;
    }
    request.on('data', chunk => {
      receivedBytes += chunk.length;
    });
    request.on('end', () => response.end());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing test server address');
    }
    const createArtifactUploadSessionAsync = jest.fn().mockResolvedValue({
      url: `http://127.0.0.1:${address.port}/log`,
      headers: { 'Content-Length': String(maximumBytes) },
    });
    jest.mocked(requireDeviceRunSessionWorkerApi).mockReturnValue({
      createArtifactUploadSessionAsync,
    } as unknown as ReturnType<typeof requireDeviceRunSessionWorkerApi>);
    const collect = async (): Promise<void> =>
      await collectAndroidEmulatorLogsAsync({} as CustomBuildContext, {
        global,
        deviceRunSessionId: 'session',
        logger,
      });

    await collect();
    await collect();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(requests).toBe(2);
    expect(receivedBytes).toBe(maximumBytes);
    expect(createArtifactUploadSessionAsync).toHaveBeenCalledTimes(1);
    expect(createArtifactUploadSessionAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining('truncated, 20 MiB retained'),
        size: maximumBytes,
        metadata: expect.objectContaining({
          originalSizeBytes: payload.length,
          omittedBytes: 6,
          truncated: true,
        }),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
