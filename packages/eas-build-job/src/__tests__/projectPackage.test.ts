import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { getInstalledExpoPackageVersionAsync } from '../projectPackage';

describe(getInstalledExpoPackageVersionAsync, () => {
  it('returns the installed expo package version resolved by project node', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-build-job-package-test-'));
    try {
      await fs.mkdir(path.join(projectDir, 'node_modules/expo'), { recursive: true });
      await fs.writeFile(
        path.join(projectDir, 'node_modules/expo/package.json'),
        JSON.stringify({ version: '55.0.17' })
      );

      await expect(getInstalledExpoPackageVersionAsync({ projectDir })).resolves.toBe('55.0.17');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('rejects when expo cannot be resolved from the project', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-build-job-package-test-'));
    try {
      await expect(getInstalledExpoPackageVersionAsync({ projectDir })).rejects.toThrow();
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });
});
