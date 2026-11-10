import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { uploadDeviceRunSessionFileAsync } from '../uploadDeviceRunSessionFile';

jest.mock('../deviceRunSessionArtifacts');
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

const ctx = {} as CustomBuildContext;
const upload = jest.mocked(uploadDeviceRunSessionArtifactAsync);
const describeFile = (size: number) => ({
  deviceRunSessionId: 'session',
  artifactId: 'log',
  name: `log (${size} bytes)`,
  filename: 'log.txt',
  kind: 'simulator-log',
});
let directory: string;
let filePath: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'device-run-session-file-'));
  filePath = path.join(directory, 'log.txt');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function uploadFile(options: { signal?: AbortSignal; attempts?: number } = {}): Promise<boolean> {
  return uploadDeviceRunSessionFileAsync(ctx, { filePath, describe: describeFile, ...options });
}

it('skips an empty file without uploading', async () => {
  await writeFile(filePath, '');
  expect(await uploadFile()).toBe(false);
  expect(upload).not.toHaveBeenCalled();
});

it('rejects a missing file before uploading', async () => {
  await expect(uploadFile()).rejects.toMatchObject({ code: 'ENOENT' });
  expect(upload).not.toHaveBeenCalled();
});

it('describes the file by its size and forwards attempts and the caller signal', async () => {
  await writeFile(filePath, 'abc');
  const controller = new AbortController();
  expect(await uploadFile({ signal: controller.signal, attempts: 2 })).toBe(true);
  expect(upload).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ name: 'log (3 bytes)', size: 3, attempts: 2, filename: 'log.txt' })
  );
  const { signal } = upload.mock.calls[0][1];
  const reason = new Error('stop');
  controller.abort(reason);
  expect(signal?.reason).toBe(reason);
});

it('aborts the upload on a file read error and ignores an aborted request body', async () => {
  await writeFile(filePath, '{}\n');
  const readError = Object.assign(new Error('read failed'), { code: 'EIO' });
  upload.mockImplementationOnce(async (_ctx, { openStream, signal }) => {
    const aborted = openStream();
    aborted.destroy(Object.assign(new Error('request body aborted'), { name: 'AbortError' }));
    await new Promise<void>(resolve => aborted.once('close', resolve));
    expect(signal?.aborted).toBe(false);
    const failed = openStream();
    failed.destroy(readError);
    await new Promise<void>(resolve => failed.once('close', resolve));
    expect(signal?.reason).toBe(readError);
  });
  expect(await uploadFile()).toBe(true);
});
