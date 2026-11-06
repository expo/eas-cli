import type { bunyan } from '@expo/logger';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { uploadServeSimNetworkCaptureFileAsync } from '../serveSimNetworkCaptureArtifacts';

jest.mock('../../../sentry');
jest.mock('../deviceRunSessionArtifacts');

const ctx = {} as CustomBuildContext;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;

async function harAsync(name: string): Promise<string> {
  const filePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'network-capture-test-')), name);
  await writeFile(filePath, '{"log":{"entries":[{}]}}');
  return filePath;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, options) => {
    options.openStream().destroy();
  });
});

it.each([
  [1, 'Network capture (ABCDEF12)'],
  [2, 'Network capture (ABCDEF12, part 2)'],
])('uploads part %i as a network-capture artifact', async (part, name) => {
  const filePath = await harAsync('A.har');
  await uploadServeSimNetworkCaptureFileAsync(ctx, {
    deviceRunSessionId: 'drs-id',
    udid: 'ABCDEF123456',
    filePath,
    size: 24,
    part,
    logger,
  });
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(ctx, {
    deviceRunSessionId: 'drs-id',
    artifactId: `network-capture-ABCDEF123456-${part}`,
    name,
    filename: 'network-capture.har',
    kind: 'network-capture',
    metadata: { __eas_type: 'network-capture', format: 'har', udid: 'ABCDEF123456', part },
    size: 24,
    openStream: expect.any(Function),
    attempts: 3,
  });
});

it('logs a failed upload without rejecting', async () => {
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValueOnce(new Error('offline'));
  await expect(
    uploadServeSimNetworkCaptureFileAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      udid: 'A',
      filePath: await harAsync('A.har'),
      size: 24,
      part: 1,
      logger,
    })
  ).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.objectContaining({ message: 'offline' }) },
    'Could not upload the network capture for A.'
  );
  expect(Sentry.capture).toHaveBeenCalledTimes(1);
});

it('accepts 500 MiB and skips larger HARs', async () => {
  const limit = 500 * 1024 * 1024;
  const filePath = await harAsync('A.har');
  for (const size of [limit, limit + 1]) {
    await uploadServeSimNetworkCaptureFileAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      udid: 'A',
      filePath,
      size,
      part: 1,
      logger,
    });
  }
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ size: limit })
  );
  expect(logger.warn).toHaveBeenCalledWith(
    'Skipping network capture for A: exceeds the 500 MB upload limit.'
  );
  expect(Sentry.capture).not.toHaveBeenCalled();
});
