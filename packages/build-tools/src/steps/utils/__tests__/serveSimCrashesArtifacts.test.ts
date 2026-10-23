import type { bunyan } from '@expo/logger';

import type { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { uploadServeSimCrashesFileAsync } from '../serveSimCrashesArtifacts';

jest.mock('../../../sentry');
jest.mock('../deviceRunSessionArtifacts');

const ctx = {} as CustomBuildContext;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const crash = { udid: 'ABCDEF123456', filePath: '/tmp/ABCDEF123456-2.ips', size: 20, number: 2 };

beforeEach(() => {
  jest.clearAllMocks();
});

it.each([
  [undefined, 'Crash report 2 (ABCDEF12)', 'crash-2.ips'],
  ['My/App:Beta\n', 'Crash report 2: My/App:Beta\n (ABCDEF12)', 'My-App-Beta--2.ips'],
])('names the report for process %j', async (processName, name, filename) => {
  await uploadServeSimCrashesFileAsync(ctx, {
    deviceRunSessionId: 'drs-id',
    crash: { ...crash, ...(processName ? { processName } : {}) },
    logger,
  });
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(ctx, {
    deviceRunSessionId: 'drs-id',
    artifactId: 'simulator-crash-ABCDEF123456-2',
    name,
    filename,
    kind: 'simulator-crash',
    metadata: { __eas_type: 'simulator-crash', udid: 'ABCDEF123456', source: 'serve-sim/crashes' },
    size: 20,
    openStream: expect.any(Function),
    attempts: 3,
  });
});

it('reports a failed upload by report number without rejecting', async () => {
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValueOnce(new Error('offline'));
  await expect(
    uploadServeSimCrashesFileAsync(ctx, { deviceRunSessionId: 'drs-id', crash, logger })
  ).resolves.toBeUndefined();
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not upload a simulator crash report',
    expect.objectContaining({ message: 'offline' }),
    { level: 'warning' }
  );
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.objectContaining({ message: 'offline' }) },
    'Could not upload crash report 2 for ABCDEF123456; other artifacts will continue.'
  );
});
