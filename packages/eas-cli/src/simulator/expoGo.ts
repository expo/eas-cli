import { stripVTControlCharacters } from 'util';

import spawnAsync from '@expo/spawn-async';
import semver from 'semver';

import { EasCommandError } from '../commandUtils/errors';
import { detectProjectSdkVersionAsync } from '../project/detectProjectSdkVersionAsync';

export type ExpoGoPlatform = 'android' | 'ios';

const EXPO_GO_DOWNLOAD_MESSAGE = 'Download Expo Go from';

function extractApplicationArchiveUrl(stdout: string): string | undefined {
  const output = stripVTControlCharacters(stdout);
  const outputLines = output.trim().split(/\r?\n/);
  const downloadMessageLine = outputLines.find(line => line.includes(EXPO_GO_DOWNLOAD_MESSAGE));
  const bareUrlOutput = outputLines.length === 1 ? outputLines[0] : undefined;
  const lineWithUrl = downloadMessageLine ?? bareUrlOutput;

  return lineWithUrl?.match(/https?:\/\/[^\s\])]+/)?.[0];
}

export async function resolveExpoGoApplicationArchiveUrlAsync({
  platform,
  projectDir,
  sdkVersion: sdkVersionFromFlag,
}: {
  platform: ExpoGoPlatform;
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
        `Run "npx expo-go url ${platform} ${sdkMajorVersion}" to diagnose the problem, or use --build-id or --application-archive-url instead.`
    );
  }

  const applicationArchiveUrl = extractApplicationArchiveUrl(stdout);
  try {
    if (!applicationArchiveUrl) {
      throw new Error('Missing URL');
    }
    const parsedUrl = new URL(applicationArchiveUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new EasCommandError(
      `expo-go returned an invalid download URL for SDK ${sdkMajorVersion} on ${platform}. ` +
        `Run "npx expo-go url ${platform} ${sdkMajorVersion}" to diagnose the problem, or use --build-id or --application-archive-url instead.`
    );
  }

  return applicationArchiveUrl;
}
