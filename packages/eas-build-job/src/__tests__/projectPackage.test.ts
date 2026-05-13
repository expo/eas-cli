import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import os from 'os';
import path from 'path';

import { errors } from '..';
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
      await expect(getInstalledExpoPackageVersionAsync({ projectDir })).rejects.toMatchObject({
        errorCode: 'EAS_BUILD_EXPO_PACKAGE_VERSION_NOT_FOUND',
      });
      await expect(getInstalledExpoPackageVersionAsync({ projectDir })).rejects.toBeInstanceOf(
        errors.UserError
      );
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('rejects when expo package.json cannot be read', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-build-job-package-test-'));
    try {
      await fs.mkdir(path.join(projectDir, 'node_modules/expo'), { recursive: true });
      await fs.writeFile(
        path.join(projectDir, 'node_modules/expo/package.json'),
        JSON.stringify({ version: '55.0.17' })
      );
      jest.spyOn(fsExtra, 'readJson').mockRejectedValueOnce(new Error('read failed'));

      const promise = getInstalledExpoPackageVersionAsync({ projectDir });
      await expect(promise).rejects.toMatchObject({
        errorCode: 'EAS_BUILD_EXPO_PACKAGE_VERSION_READ_FAILED',
      });
      await expect(promise).rejects.toBeInstanceOf(errors.UserError);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('rejects when the installed expo package version is not valid semver', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-build-job-package-test-'));
    try {
      await fs.mkdir(path.join(projectDir, 'node_modules/expo'), { recursive: true });
      await fs.writeFile(
        path.join(projectDir, 'node_modules/expo/package.json'),
        JSON.stringify({ version: 'invalid-version' })
      );

      await expect(getInstalledExpoPackageVersionAsync({ projectDir })).rejects.toMatchObject({
        errorCode: 'EAS_BUILD_EXPO_PACKAGE_VERSION_INVALID',
      });
      await expect(getInstalledExpoPackageVersionAsync({ projectDir })).rejects.toBeInstanceOf(
        errors.UserError
      );
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });
});
