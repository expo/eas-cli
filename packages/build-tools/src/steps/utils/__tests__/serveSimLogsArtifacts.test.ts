import { type bunyan } from '@expo/logger';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { uploadServeSimLogsFileAsync } from '../serveSimLogsArtifacts';

jest.mock('../deviceRunSessionArtifacts');
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const ctx = {} as CustomBuildContext;
const filePath = path.join(os.tmpdir(), 'logs.ndjson');
const args = { deviceRunSessionId: 'session', udid: 'A', filePath, logger };

it('uploads NDJSON with explicit user-app scope', async () => {
  await writeFile(filePath, '{"pid":42}\n');
  await uploadServeSimLogsFileAsync(ctx, args);
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      kind: 'simulator-log',
      filename: 'app-logs.ndjson',
      size: 11,
      attempts: 1,
      metadata: expect.objectContaining({ scope: 'user-apps', udid: 'A' }),
    })
  );
});

it('warns and resolves when the upload fails', async () => {
  await writeFile(filePath, '{}\n');
  jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(uploadServeSimLogsFileAsync(ctx, args)).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.any(Error) }),
    expect.stringContaining('Could not upload')
  );
});
