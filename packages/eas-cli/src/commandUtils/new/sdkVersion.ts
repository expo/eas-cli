import { TemplateInfo, fetchTemplatePackumentAsync } from './commands';
import { getExpoApiBaseUrl } from '../../api';
import fetch from '../../fetch';
import Log from '../../log';
import { promptAsync } from '../../prompts';

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
    const response = await fetch(`${getExpoApiBaseUrl()}/v2/versions`, {
      signal: AbortSignal.timeout(5000),
    });
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

  if (
    expoGoCompatible !== null &&
    expoGoCompatible !== latest &&
    available.includes(expoGoCompatible)
  ) {
    choices.push({
      title: `For learning with Expo Go (SDK ${expoGoCompatible})`,
      value: expoGoCompatible,
      description: 'Compatible with Expo Go on App Store and Play Store',
    });
  }

  const otherVersions = available.filter(sdk => sdk !== latest && sdk !== expoGoCompatible);
  if (otherVersions.length > 0) {
    choices.push({ title: 'Other SDK version…', value: 'other' });
  }

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
    choices: otherVersions.map(sdk => ({
      title: `SDK ${sdk}`,
      value: sdk,
    })),
  });

  return sdkVersion;
}

function resolveTemplateForTag(
  distTags: Record<string, string>,
  versions: Record<string, { dist: { tarball: string } }>,
  npmTag: string
): TemplateInfo {
  const version = distTags[npmTag];
  const tarballUrl = version ? versions[version]?.dist.tarball : undefined;
  if (!version || !tarballUrl) {
    const supported = Object.keys(distTags)
      .filter(tag => /^sdk-\d+$/.test(tag))
      .sort((a, b) => parseInt(b.slice(4), 10) - parseInt(a.slice(4), 10));
    throw new Error(
      `A project template for "${npmTag}" is not available. Supported SDK versions: ${supported
        .map(tag => tag.slice(4))
        .join(', ')}.`
    );
  }
  return { npmTag, version, tarballUrl };
}

/**
 * Resolves the project template version to download.
 * - When `sdkVersion` is provided (e.g. "57", "sdk-57", or "latest"), uses it directly.
 * - In non-interactive (non-TTY) sessions, pins to the latest released SDK.
 * - Otherwise prompts for the SDK version, offering only versions that have
 *   a published template on npm.
 * - Falls back to the latest template when the versions endpoint is unavailable.
 */
export async function resolveTemplateAsync({
  sdkVersion,
}: {
  sdkVersion?: string;
}): Promise<TemplateInfo> {
  const packument = await fetchTemplatePackumentAsync();
  const distTags = packument['dist-tags'] ?? {};
  const packumentVersions = packument.versions ?? {};

  if (sdkVersion) {
    if (sdkVersion === 'latest') {
      return resolveTemplateForTag(distTags, packumentVersions, 'latest');
    }
    const major = parseSdkMajor(sdkVersion.replace(/^sdk-/, ''));
    if (major === null) {
      throw new Error(
        `Invalid SDK version: "${sdkVersion}". Specify a version number (e.g. 57) or "latest".`
      );
    }
    return resolveTemplateForTag(distTags, packumentVersions, `sdk-${major}`);
  }

  const versions = await fetchSdkVersionsAsync();
  // Offer only SDK versions that have a published template on npm.
  const available = versions?.available.filter(sdk => `sdk-${sdk}` in distTags) ?? [];

  if (!versions || available.length === 0) {
    if (!versions) {
      Log.warn('Could not fetch the list of Expo SDK versions. Using the latest SDK.');
    }
    return resolveTemplateForTag(distTags, packumentVersions, 'latest');
  }

  const latest = available[0];

  // Match the prompt guard in prompts.ts: pin to the latest released SDK
  // instead of prompting when stdin is not interactive.
  if (!process.stdin.isTTY && !global.test) {
    Log.withInfo(`Using Expo SDK ${latest}`);
    return resolveTemplateForTag(distTags, packumentVersions, `sdk-${latest}`);
  }

  const selectedSdk = await promptForSdkVersionAsync({
    latest,
    expoGoCompatible: versions.expoGoCompatible,
    available,
  });
  return resolveTemplateForTag(distTags, packumentVersions, `sdk-${selectedSdk}`);
}
