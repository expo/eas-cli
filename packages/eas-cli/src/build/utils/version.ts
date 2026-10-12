import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import nullthrows from 'nullthrows';
import semver from 'semver';

import { updateAppJsonConfigAsync } from './appJson';
import Log from '../../log';
import { promptAsync } from '../../prompts';

export function ensureStaticConfigExists(projectDir: string): void {
  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath) {
    throw new Error('autoIncrement option is not supported when using app.config.js');
  }
}

export async function bumpAppVersionAsync({
  appVersion,
  projectDir,
  exp,
  platform,
}: {
  appVersion: string;
  projectDir: string;
  exp: ExpoConfig;
  platform: Platform;
}): Promise<void> {
  const { fieldName, versionUpdater } = getVersionConfigTarget({ exp, platform });

  let bumpedAppVersion: string;
  if (semver.valid(appVersion)) {
    bumpedAppVersion = nullthrows(semver.inc(appVersion, 'patch'));
    Log.log(
      `Bumping ${chalk.bold(fieldName)} from ${chalk.bold(appVersion)} to ${chalk.bold(
        bumpedAppVersion
      )}`
    );
  } else {
    Log.log(`${chalk.bold(fieldName)} = ${chalk.bold(appVersion)} is not a valid semver`);
    bumpedAppVersion = (
      await promptAsync({
        type: 'text',
        name: 'bumpedAppVersion',
        message: 'What is the next version?',
      })
    ).bumpedAppVersion;
  }
  await updateAppJsonConfigAsync({ projectDir, exp }, config => {
    versionUpdater(config, bumpedAppVersion);
  });
}

/**
 * Get the target version field from ExpoConfig based on the platform.
 */
export function getVersionConfigTarget({
  exp,
  platform,
}: {
  exp: ExpoConfig;
  platform: Platform;
}): {
  fieldName: string;
  versionGetter: (config: ExpoConfig) => string | undefined;
  versionUpdater: (config: ExpoConfig, version: string) => ExpoConfig;
} {
  // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
  if (platform === Platform.ANDROID && typeof exp.android?.version === 'string') {
    return {
      fieldName: 'expo.android.version',
      // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
      versionGetter: config => config.android?.version,
      versionUpdater: (config, version) => {
        // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
        config.android = { ...config.android, version };
        return config;
      },
    };
    // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
  } else if (platform === Platform.IOS && typeof exp.ios?.version === 'string') {
    return {
      fieldName: 'expo.ios.version',
      // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
      versionGetter: config => config.ios?.version,
      versionUpdater: (config, version) => {
        // @ts-expect-error: Resolve type errors after upgrading `@expo/config`
        config.ios = { ...config.ios, version };
        return config;
      },
    };
  }

  return {
    fieldName: 'expo.version',
    versionGetter: config => config.version,
    versionUpdater: (config, version) => {
      config.version = version;
      return config;
    },
  };
}
