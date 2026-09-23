import { ExpoConfig } from '@expo/config';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import path from 'path';

import Log from '../../log';
import { createOrModifyExpoConfigAsync } from '../../project/expoConfig';

export type DetourConnection = { appId: string; linkHost?: string };

/** The link host is stored so `disconnect` removes exactly what it wrote. */
export function readConnection(exp: ExpoConfig): DetourConnection | undefined {
  const detour = (exp.extra as Record<string, unknown> | undefined)?.detour as
    | { appId?: unknown; linkHost?: unknown }
    | undefined;
  if (typeof detour?.appId !== 'string') {
    return undefined;
  }
  return {
    appId: detour.appId,
    linkHost: typeof detour.linkHost === 'string' ? detour.linkHost : undefined,
  };
}

type RawExpoConfig = Record<string, any>;

/** A looser match leaves the domain unverified, so ours still has to be written. */
function isVerifiedHttpsFilter(filter: AndroidIntentFilter, linkHost: string): boolean {
  const data = Array.isArray(filter.data) ? filter.data : filter.data ? [filter.data] : [];
  return (
    filter.autoVerify === true &&
    data.some(item => item?.host === linkHost && item?.scheme === 'https')
  );
}

// Inline in ExpoConfig rather than exported, so derive it.
type AndroidIntentFilter = NonNullable<NonNullable<ExpoConfig['android']>['intentFilters']>[number];

/**
 * app.json as written, not as resolved: writing the resolved config back would
 * copy AndroidManifest.xml's intent filters into it.
 */
async function readRawAppJsonAsync(
  projectDir: string
): Promise<{ filePath: string; root: RawExpoConfig; exp: RawExpoConfig } | null> {
  const filePath = path.join(projectDir, 'app.json');
  if (!(await fs.pathExists(filePath))) {
    return null;
  }
  try {
    const root = await fs.readJson(filePath);
    return { filePath, root, exp: (root?.expo ?? {}) as RawExpoConfig };
  } catch (error) {
    Log.debug(error);
    return null;
  }
}

async function readRawExpoConfigAsync(projectDir: string): Promise<RawExpoConfig | null> {
  return (await readRawAppJsonAsync(projectDir))?.exp ?? null;
}

/** The app id goes into the committed app.json so a teammate reuses the app. */
export async function updateAppConfigAsync(
  projectDir: string,
  { linkHost, appId }: { linkHost: string; appId: string }
): Promise<string | null> {
  const associatedDomain = `applinks:${linkHost}`;
  const intentFilter: AndroidIntentFilter = {
    action: 'VIEW',
    autoVerify: true,
    data: [{ scheme: 'https', host: linkHost }],
    category: ['BROWSABLE', 'DEFAULT'],
  };
  const instructions = `Add ${JSON.stringify(
    associatedDomain
  )} to "ios.associatedDomains", ${JSON.stringify(
    intentFilter
  )} to "android.intentFilters", and ${JSON.stringify({
    detour: { appId, linkHost },
  })} to "extra", in your app config.`;

  const raw = await readRawExpoConfigAsync(projectDir);
  if (!raw) {
    return instructions;
  }

  const rawExtra = (raw.extra ?? {}) as RawExpoConfig;
  const domains: string[] = ((raw.ios ?? {}) as RawExpoConfig).associatedDomains ?? [];
  const filters: AndroidIntentFilter[] = ((raw.android ?? {}) as RawExpoConfig).intentFilters ?? [];

  const hasDomain = domains.includes(associatedDomain);
  const hasFilter = filters.some(filter => isVerifiedHttpsFilter(filter, linkHost));
  const storedDetour = (rawExtra.detour as RawExpoConfig | undefined) ?? {};
  const hasAppId = storedDetour.appId === appId && storedDetour.linkHost === linkHost;

  if (hasDomain && hasFilter && hasAppId) {
    Log.withTick(`App config already links ${chalk.bold(linkHost)}`);
    return null;
  }

  // Only the delta: deepmerge concatenates arrays, so an existing entry sent
  // back would be duplicated.
  const modification = await createOrModifyExpoConfigAsync(
    projectDir,
    {
      extra: { detour: { appId, linkHost } },
      ...(hasDomain ? {} : { ios: { associatedDomains: [associatedDomain] } }),
      ...(hasFilter ? {} : { android: { intentFilters: [intentFilter] } }),
    },
    { skipSDKVersionRequirement: true }
  );

  if (modification.type === 'success') {
    Log.withTick(`Added ${chalk.bold(linkHost)} to the app config`);
    return null;
  }
  return modification.type === 'warn' ? `${modification.message} ${instructions}` : instructions;
}

/**
 * Removes only the entries matching the recorded link host. Writes app.json
 * directly: deepmerge can only grow an array, never shorten one.
 */
export async function removeFromAppConfigAsync(
  projectDir: string,
  { linkHost }: { linkHost?: string }
): Promise<string | null> {
  const manualStep =
    'Remove the Detour entries from "ios.associatedDomains", "android.intentFilters" and "extra" in your app config.';

  const appJson = await readRawAppJsonAsync(projectDir);
  if (!appJson) {
    return manualStep;
  }

  const { filePath, root, exp } = appJson;
  const rawIos = (exp.ios ?? {}) as RawExpoConfig;
  const rawAndroid = (exp.android ?? {}) as RawExpoConfig;
  const rawExtra = (exp.extra ?? {}) as RawExpoConfig;
  const { detour: _removed, ...extraWithoutDetour } = rawExtra;

  const domains: string[] = rawIos.associatedDomains ?? [];
  const filters: AndroidIntentFilter[] = rawAndroid.intentFilters ?? [];

  const nextExp: RawExpoConfig = { ...exp, extra: extraWithoutDetour };
  if (linkHost) {
    if (rawIos.associatedDomains) {
      nextExp.ios = {
        ...rawIos,
        associatedDomains: domains.filter(domain => domain !== `applinks:${linkHost}`),
      };
    }
    if (rawAndroid.intentFilters) {
      nextExp.android = {
        ...rawAndroid,
        intentFilters: filters.filter(filter => !isVerifiedHttpsFilter(filter, linkHost)),
      };
    }
  }

  try {
    await fs.writeJson(filePath, { ...root, expo: nextExp }, { spaces: 2 });
  } catch (error) {
    Log.debug(error);
    return manualStep;
  }

  Log.withTick('Removed the Detour entries from the app config');
  return null;
}
