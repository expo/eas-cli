import type { bunyan } from '@expo/logger';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { uploadNetworkCaptureHarsAsync } from '../networkCaptureArtifacts';

jest.mock('../../../sentry');
jest.mock('../deviceRunSessionArtifacts');

const ctx = {} as CustomBuildContext;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;

async function harAsync(name: string): Promise<string> {
  const filePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'network-capture-test-')), name);
  await writeFile(filePath, '{"log":{"entries":[]}}');
  return filePath;
}

beforeEach(() => {
  jest.clearAllMocks();
  // The real helper destroys the stream it was given.
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, options) => {
    options.stream.destroy();
  });
});

it('uploads each HAR as a network-capture artifact, numbering restarts per device', async () => {
  const first = await harAsync('A-1.har');
  const second = await harAsync('A-2.har');
  const other = await harAsync('B-1.har');
  await uploadNetworkCaptureHarsAsync(ctx, {
    deviceRunSessionId: 'drs-id',
    captures: [
      { udid: 'ABCDEF123456', filePath: first, size: 22 },
      { udid: 'ABCDEF123456', filePath: second, size: 22 },
      { udid: 'OTHER9876543', filePath: other, size: 22 },
    ],
    logger,
  });
  const calls = jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mock.calls.map(([, options]) => options);
  expect(calls.map(({ artifactId, name }) => [artifactId, name])).toEqual([
    ['network-capture-ABCDEF123456-1', 'Network capture (ABCDEF12)'],
    ['network-capture-ABCDEF123456-2', 'Network capture (ABCDEF12, part 2)'],
    ['network-capture-OTHER9876543-1', 'Network capture (OTHER987)'],
  ]);
  expect(calls[0]).toEqual({
    deviceRunSessionId: 'drs-id',
    artifactId: 'network-capture-ABCDEF123456-1',
    name: 'Network capture (ABCDEF12)',
    filename: 'network-capture.har',
    kind: 'network-capture',
    metadata: { __eas_type: 'network-capture', format: 'har', udid: 'ABCDEF123456', part: 1 },
    size: 22,
    stream: expect.any(Readable),
    reopenStream: expect.any(Function),
  });
});

it('logs a failed upload and continues with the next HAR', async () => {
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementationOnce(async (_ctx, options) => {
    options.stream.destroy();
    throw new Error('offline');
  });
  await expect(
    uploadNetworkCaptureHarsAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      captures: [
        { udid: 'A', filePath: await harAsync('A.har'), size: 22 },
        { udid: 'B', filePath: await harAsync('B.har'), size: 22 },
      ],
      logger,
    })
  ).resolves.toBeUndefined();
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.any(Error) },
    'Could not upload the network capture for A.'
  );
  expect(Sentry.capture).toHaveBeenCalledTimes(1);
});
