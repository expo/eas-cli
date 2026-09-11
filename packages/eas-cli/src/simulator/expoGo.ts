import semver from 'semver';

import { EasCommandError } from '../commandUtils/errors';
import { detectProjectSdkVersionAsync } from '../project/detectProjectSdkVersionAsync';

export async function resolveExpoGoSdkVersionAsync({
  projectDir,
  sdkVersion: sdkVersionFromFlag,
}: {
  projectDir: string;
  sdkVersion?: string;
}): Promise<string> {
  const sdkVersion = sdkVersionFromFlag ?? (await detectProjectSdkVersionAsync(projectDir));
  const sdkMajorVersion = semver.coerce(sdkVersion)?.major;
  if (!sdkMajorVersion) {
    if (sdkVersionFromFlag) {
      throw new EasCommandError(
        `Unable to parse Expo SDK version "${sdkVersionFromFlag}". Pass a major or semantic version, such as --sdk-version 57.`
      );
    }
    throw new EasCommandError(
      "Unable to determine this project's Expo SDK version, so Expo Go could not be selected. " +
        'Make sure the project has Expo installed and a valid app config, or use --build-id or --application-archive-url instead.'
    );
  }

  return `${sdkMajorVersion}.0.0`;
}
