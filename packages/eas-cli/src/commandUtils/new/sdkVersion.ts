import { getExpoApiBaseUrl } from '../../api';
import fetch from '../../fetch';
import Log from '../../log';
import { promptAsync } from '../../prompts';

/**
 * The `expo-template-default` npm package publishes a dist-tag per SDK
 * (e.g. `sdk-57`) and `latest` for the most recent stable release.
 */
export const TEMPLATE_LATEST_TAG = 'latest';

export interface SdkVersions {
  latest: number;
  expoGoCompatible: number | null;
  available: number[];
}

interface VersionsEndpointResponse {
  sdkVersions?: Record<string, { releaseNoteUrl?: string; isDeprecated?: boolean }>;
  expoGoSdkVersion?: string;
}

/**
 * Fetches the released Expo SDK versions from the versions endpoint.
 * SDKs without a `releaseNoteUrl` are canary/in-development and are excluded.
 * Returns null when the endpoint cannot be reached, so callers can fall back
 * to the latest template.
 */
export async function fetchSdkVersionsAsync(): Promise<SdkVersions | null> {
  let json: VersionsEndpointResponse;
  try {
    const response = await fetch(`${getExpoApiBaseUrl()}/v2/versions`);
    json = (await response.json()) as VersionsEndpointResponse;
  } catch (error) {
    Log.debug(`Failed to fetch SDK versions: ${error}`);
    return null;
  }

  const available = Object.entries(json.sdkVersions ?? {})
    .filter(([, info]) => !!info.releaseNoteUrl && !info.isDeprecated)
    .map(([version]) => parseSdkMajor(version))
    .filter((major): major is number => major !== null)
    .sort((a, b) => b - a);

  const latest = available[0];
  if (latest == null) {
    return null;
  }

  return {
    latest,
    expoGoCompatible: parseSdkMajor(json.expoGoSdkVersion),
    available,
  };
}

function parseSdkMajor(version: string | undefined): number | null {
  const major = parseInt(version?.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * Prompts for the Expo SDK version to use for the new project, mirroring the
 * prompt in create-expo-app.
 */
export async function promptForSdkVersionAsync({
  latest,
  expoGoCompatible,
  available,
}: SdkVersions): Promise<number> {
  const choices: { title: string; value: number | 'other'; description?: string }[] = [
    {
      title: `Latest (SDK ${latest})`,
      value: latest,
      description: 'Recommended for most projects',
    },
  ];

  if (expoGoCompatible !== null && expoGoCompatible !== latest) {
    choices.push({
      title: `For learning with Expo Go (SDK ${expoGoCompatible})`,
      value: expoGoCompatible,
      description: 'Compatible with Expo Go on App Store and Play Store',
    });
  }

  choices.push({ title: 'Other SDK version…', value: 'other' });

  const { answer } = await promptAsync({
    type: 'select',
    name: 'answer',
    message: 'Select an Expo SDK version:',
    choices,
  });

  if (answer !== 'other') {
    return answer;
  }

  const { sdkVersion } = await promptAsync({
    type: 'select',
    name: 'sdkVersion',
    message: 'Select an SDK version:',
    choices: available.slice(0, 4).map(sdk => ({
      title: `SDK ${sdk}`,
      value: sdk,
    })),
  });

  return sdkVersion;
}

/**
 * Resolves the npm dist-tag of the project template to download.
 * - When `sdkVersion` is provided (e.g. "57" or "sdk-57"), uses it directly.
 * - Otherwise prompts for the SDK version.
 * - Falls back to the latest template when the versions endpoint is unavailable.
 */
export async function resolveTemplateSdkTagAsync({
  sdkVersion,
}: {
  sdkVersion?: string;
}): Promise<string> {
  if (sdkVersion) {
    const major = parseSdkMajor(sdkVersion.replace(/^sdk-/, ''));
    if (major === null) {
      throw new Error(`Invalid SDK version: "${sdkVersion}". Specify a version number, e.g. 57.`);
    }
    return `sdk-${major}`;
  }

  const versions = await fetchSdkVersionsAsync();
  if (!versions) {
    Log.warn('Could not fetch the list of Expo SDK versions. Using the latest SDK.');
    return TEMPLATE_LATEST_TAG;
  }

  const selectedSdk = await promptForSdkVersionAsync(versions);
  return `sdk-${selectedSdk}`;
}
