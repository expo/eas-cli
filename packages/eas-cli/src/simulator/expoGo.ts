import spawnAsync from '@expo/spawn-async';
import semver from 'semver';

import { EasCommandError } from '../commandUtils/errors';
import { detectProjectSdkVersionAsync } from '../project/detectProjectSdkVersionAsync';

export type ExpoGoPlatform = 'android' | 'ios';

export async function resolveExpoGoApplicationArchiveUrlAsync({
  platform,
  projectDir,
}: {
  platform: ExpoGoPlatform;
  projectDir: string;
}): Promise<string> {
  const sdkVersion = await detectProjectSdkVersionAsync(projectDir);
  const sdkMajorVersion = semver.coerce(sdkVersion)?.major;
  if (!sdkMajorVersion) {
    throw new EasCommandError(
      "Unable to determine this project's Expo SDK version, so Expo Go could not be selected. " +
        'Make sure the project has Expo installed and a valid app config, or use --build-id or --build-artifact-url instead.'
    );
  }

  const args = ['--yes', 'expo-go', 'url', platform, String(sdkMajorVersion)];
  let stdout: string;
  try {
    ({ stdout } = await spawnAsync('npx', args, {
      cwd: projectDir,
      stdio: 'pipe',
    }));
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : '';
    throw new EasCommandError(
      `Failed to resolve the Expo Go download URL for SDK ${sdkMajorVersion} on ${platform}.${reason} ` +
        `Run "npx expo-go url ${platform} ${sdkMajorVersion}" to diagnose the problem, or use --build-id or --build-artifact-url instead.`
    );
  }

  const applicationArchiveUrl = stdout.trim();
  try {
    const parsedUrl = new URL(applicationArchiveUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new EasCommandError(
      `expo-go returned an invalid download URL for SDK ${sdkMajorVersion} on ${platform}. ` +
        `Run "npx expo-go url ${platform} ${sdkMajorVersion}" to diagnose the problem, or use --build-id or --build-artifact-url instead.`
    );
  }

  return applicationArchiveUrl;
}
