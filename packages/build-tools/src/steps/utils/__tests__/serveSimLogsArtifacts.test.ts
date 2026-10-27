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
      metadata: expect.objectContaining({ scope: 'user-apps', udid: 'A' }),
    })
  );
});

it('skips empty and missing files', async () => {
  await uploadServeSimLogsFileAsync(ctx, args);
  await writeFile(filePath, '');
  await uploadServeSimLogsFileAsync(ctx, args);
  expect(uploadDeviceRunSessionArtifactAsync).not.toHaveBeenCalled();
});

it('aborts the upload on a file read error without an unhandled error', async () => {
  await writeFile(filePath, '{}\n');
  jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mockImplementationOnce(async (_ctx, { openStream, signal }) => {
      const aborted = new Promise<void>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
      openStream().destroy(new Error('read failure'));
      await aborted;
    });
  await expect(uploadServeSimLogsFileAsync(ctx, args)).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.any(Error) }),
    expect.stringContaining('Could not upload')
  );
});
