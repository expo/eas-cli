import spawn from '@expo/turtle-spawn';
import { asyncResult } from '@expo/results';
import fs from 'fs-extra';
import semver from 'semver';

import { type Env } from './common';
import * as errors from './errors';

export async function getInstalledExpoPackageVersionAsync({
  env = process.env,
  projectDir,
}: {
  env?: Env | NodeJS.ProcessEnv;
  projectDir: string;
}): Promise<string> {
  const expoPackageJsonPathResult = await asyncResult(
    spawn('node', ['--print', "require.resolve('expo/package.json')"], {
      cwd: projectDir,
      env,
      stdio: 'pipe',
    })
  );
  if (!expoPackageJsonPathResult.ok) {
    throw new errors.UserError(
      'EAS_BUILD_EXPO_PACKAGE_VERSION_NOT_FOUND',
      'Cannot resolve the installed expo package version because require.resolve("expo/package.json") failed.',
      { cause: expoPackageJsonPathResult.reason }
    );
  }

  const expoPackageJsonPath = expoPackageJsonPathResult.value.stdout.toString().trim();
  const expoPackageJsonResult = await asyncResult(fs.readJson(expoPackageJsonPath));
  if (!expoPackageJsonResult.ok) {
    throw new errors.UserError(
      'EAS_BUILD_EXPO_PACKAGE_VERSION_READ_FAILED',
      'Cannot resolve the installed expo package version because expo/package.json could not be read.',
      { cause: expoPackageJsonResult.reason }
    );
  }

  const expoPackageVersion = expoPackageJsonResult.value.version;
  if (typeof expoPackageVersion !== 'string' || !semver.valid(expoPackageVersion)) {
    throw new errors.UserError(
      'EAS_BUILD_EXPO_PACKAGE_VERSION_INVALID',
      'Cannot resolve the installed expo package version because expo/package.json has an invalid version.'
    );
  }

  return expoPackageVersion;
}
