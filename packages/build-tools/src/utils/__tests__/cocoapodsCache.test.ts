import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  compressCocoapodsCacheAsync,
  getCocoapodsCachePaths,
  resolveCocoapodsCacheKeyAsync,
  restoreCocoapodsCacheArchiveAsync,
} from '../cocoapodsCache';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

describe('CocoaPods cache utilities', () => {
  let workingDirectory: string;
  const cocoapodsVersion = '1.16.2';

  beforeEach(async () => {
    workingDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cocoapods-cache-test-'));
    await fs.promises.mkdir(path.join(workingDirectory, 'ios'), { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(workingDirectory, { recursive: true, force: true });
  });

  it('uses a CocoaPods version prefix when no Podfile.lock exists', async () => {
    await expect(
      resolveCocoapodsCacheKeyAsync(workingDirectory, cocoapodsVersion)
    ).resolves.toEqual({
      key: 'ios-pods-1.16.2-no-lockfile',
      keyPrefix: 'ios-pods-1.16.2-',
    });
  });

  it('includes the Podfile.lock hash when it exists', async () => {
    const { podfileLockPath } = getCocoapodsCachePaths(workingDirectory);
    await fs.promises.writeFile(podfileLockPath, 'PODS:\n  - Expo (55.0.0)\n');

    const firstResult = await resolveCocoapodsCacheKeyAsync(workingDirectory, cocoapodsVersion);
    expect(firstResult.key).toMatch(/^ios-pods-1\.16\.2-[a-f0-9]+$/);
    expect(firstResult.keyPrefix).toBe('ios-pods-1.16.2-');

    await fs.promises.writeFile(podfileLockPath, 'PODS:\n  - Expo (56.0.0)\n');
    const secondResult = await resolveCocoapodsCacheKeyAsync(workingDirectory, cocoapodsVersion);
    expect(secondResult.key).not.toBe(firstResult.key);
  });

  it('preserves symlinks and executable permissions through an archive round trip', async () => {
    const { podsDirectory } = getCocoapodsCachePaths(workingDirectory);
    const frameworkVersionsDirectory = path.join(podsDirectory, 'Example.framework', 'Versions');
    const frameworkVersionDirectory = path.join(frameworkVersionsDirectory, 'A');
    await fs.promises.mkdir(frameworkVersionDirectory, { recursive: true });
    await fs.promises.writeFile(path.join(frameworkVersionDirectory, 'Example'), 'binary');
    await fs.promises.symlink('A', path.join(frameworkVersionsDirectory, 'Current'));

    const scriptPath = path.join(podsDirectory, 'Target Support Files', 'script.sh');
    await fs.promises.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.promises.writeFile(scriptPath, '#!/bin/sh\n');
    await fs.promises.chmod(scriptPath, 0o755);

    const { archivePath } = await compressCocoapodsCacheAsync({ workingDirectory });
    await fs.promises.rm(podsDirectory, { recursive: true, force: true });
    await restoreCocoapodsCacheArchiveAsync({ archivePath, workingDirectory });

    const restoredSymlinkPath = path.join(frameworkVersionsDirectory, 'Current');
    expect((await fs.promises.lstat(restoredSymlinkPath)).isSymbolicLink()).toBe(true);
    await expect(fs.promises.readlink(restoredSymlinkPath)).resolves.toBe('A');

    const restoredScriptStat = await fs.promises.stat(scriptPath);
    expect(restoredScriptStat.mode & 0o111).toBe(0o111);

    await fs.promises.rm(path.dirname(archivePath), { recursive: true, force: true });
  });
});
