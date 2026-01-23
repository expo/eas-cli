import fs from 'fs/promises';
import os from 'os';

import {
  cleanUpStepTemporaryDirectoriesAsync,
  getTemporaryOutputsDirPath,
  saveScriptToTemporaryFileAsync,
} from '../BuildTemporaryFiles';

import { createGlobalContextMock } from './utils/context';

describe(saveScriptToTemporaryFileAsync, () => {
  it('saves the script in a directory inside os.tmpdir()', async () => {
    const ctx = createGlobalContextMock();
    const scriptPath = await saveScriptToTemporaryFileAsync(ctx, 'foo', 'echo 123\necho 456');
    expect(scriptPath.startsWith(os.tmpdir())).toBe(true);
  });
  it('saves the script to a temporary file', async () => {
    const ctx = createGlobalContextMock();
    const contents = 'echo 123\necho 456';
    const scriptPath = await saveScriptToTemporaryFileAsync(ctx, 'foo', contents);
    await expect(fs.readFile(scriptPath, 'utf-8')).resolves.toBe(contents);
  });
});

describe(cleanUpStepTemporaryDirectoriesAsync, () => {
  it('removes the step temporary directories', async () => {
    const ctx = createGlobalContextMock();
    const scriptPath = await saveScriptToTemporaryFileAsync(ctx, 'foo', 'echo 123');
    const outputsPath = getTemporaryOutputsDirPath(ctx, 'foo');
    await fs.mkdir(outputsPath, { recursive: true });
    await expect(fs.stat(scriptPath)).resolves.toBeTruthy();
    await expect(fs.stat(outputsPath)).resolves.toBeTruthy();
    await cleanUpStepTemporaryDirectoriesAsync(ctx, 'foo');
    await expect(fs.stat(scriptPath)).rejects.toThrow(/no such file or directory/);
    await expect(fs.stat(outputsPath)).rejects.toThrow(/no such file or directory/);
  });

  it(`doesn't fail if temporary directories don't exist`, async () => {
    const ctx = createGlobalContextMock();
    await expect(cleanUpStepTemporaryDirectoriesAsync(ctx, 'foo')).resolves.not.toThrow();
  });
});
