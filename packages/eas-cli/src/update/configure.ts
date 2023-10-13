import { ExpoConfig } from '@expo/config-types';
import { Platform, Workflow } from '@expo/eas-build-job';
import { EasJsonAccessor } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import semver from 'semver';

import { getEASUpdateURL } from '../api';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../graphql/generated';
import Log, { learnMore } from '../log';
import { RequestedPlatform, appPlatformDisplayNames } from '../platform';
import { createOrModifyExpoConfigAsync, isUsingStaticExpoConfig } from '../project/expoConfig';
import {
  installExpoUpdatesAsync,
  isExpoUpdatesInstalledAsDevDependency,
  isExpoUpdatesInstalledOrAvailable,
} from '../project/projectUtils';
import { resolveWorkflowPerPlatformAsync } from '../project/workflow';
import { confirmAsync } from '../prompts';
import { Client } from '../vcs/vcs';
import { syncUpdatesConfigurationAsync as syncAndroidUpdatesConfigurationAsync } from './android/UpdatesModule';
import { syncUpdatesConfigurationAsync as syncIosUpdatesConfigurationAsync } from './ios/UpdatesModule';

export const DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49 = { policy: 'appVersion' } as const;
export const DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48 = { policy: 'sdkVersion' } as const;
export const DEFAULT_BARE_RUNTIME_VERSION = '1.0.0' as const;

export function getDefaultRuntimeVersion(
  workflow: Workflow,
  sdkVersion: string | undefined
): NonNullable<ExpoConfig['runtimeVersion']> {
  if (workflow === Workflow.GENERIC) {
    return DEFAULT_BARE_RUNTIME_VERSION;
  }
  // Expo Go supports loading appVersion SDK 49 and above
  const hasSupportedSdk = sdkVersion && semver.satisfies(sdkVersion, '>= 49.0.0');
  return hasSupportedSdk
    ? DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49
    : DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48;
}

function isRuntimeEqual(
  runtimeVersionA: NonNullable<ExpoConfig['runtimeVersion']>,
  runtimeVersionB: NonNullable<ExpoConfig['runtimeVersion']>
): boolean {
  if (typeof runtimeVersionA === 'string' && typeof runtimeVersionB === 'string') {
    return runtimeVersionA === runtimeVersionB;
  } else if (typeof runtimeVersionA === 'object' && typeof runtimeVersionB === 'object') {
    return runtimeVersionA.policy === runtimeVersionB.policy;
  } else {
    return false;
  }
}

function replaceUndefinedObjectValues(
  value: Record<string, any>,
  replacement: any
): Record<string, any> {
  for (const key in value) {
    if (value[key] === undefined) {
      value[key] = replacement;
    } else if (typeof value[key] === 'object') {
      value[key] = replaceUndefinedObjectValues(value[key], replacement);
    }
  }
  return value;
}

/**
 * Partially merge the EAS Update config with the existing Expo config.
 * This preserves and merges the nested update-related properties.
 */
function mergeExpoConfig(exp: ExpoConfig, modifyExp: Partial<ExpoConfig>): Partial<ExpoConfig> {
  return {
    runtimeVersion: modifyExp.runtimeVersion ?? exp.runtimeVersion,
    updates: { ...exp.updates, ...modifyExp.updates },
    android: {
      ...exp.android,
      ...modifyExp.android,
    },
    ios: {
      ...exp.ios,
      ...modifyExp.ios,
    },
  };
}

/**
 * Make sure the `app.json` is configured to use EAS Updates.
 * This does a couple of things:
 *   - Ensure update URL is set to the project EAS endpoint
 *   - Ensure runtimeVersion is defined for both or individual platforms
 *   - Output the changes made, or the changes required to make manually
 */
async function ensureEASUpdatesIsConfiguredInExpoConfigAsync({
  exp,
  projectId,
  projectDir,
  platform,
  workflows,
}: {
  exp: ExpoConfig;
  projectId: string;
  projectDir: string;
  platform: RequestedPlatform;
  workflows: Record<Platform, Workflow>;
}): Promise<{ projectChanged: boolean; exp: ExpoConfig }> {
  const modifyConfig: Partial<ExpoConfig> = {};

  if (exp.updates?.url !== getEASUpdateURL(projectId)) {
    modifyConfig.updates = { url: getEASUpdateURL(projectId) };
  }

  let androidRuntimeVersion = exp.android?.runtimeVersion ?? exp.runtimeVersion;
  let iosRuntimeVersion = exp.ios?.runtimeVersion ?? exp.runtimeVersion;

  if (
    (['all', 'android'].includes(platform) && !androidRuntimeVersion) ||
    (['all', 'ios'].includes(platform) && !iosRuntimeVersion)
  ) {
    androidRuntimeVersion =
      androidRuntimeVersion ?? getDefaultRuntimeVersion(workflows.android, exp.sdkVersion);
    iosRuntimeVersion =
      iosRuntimeVersion ?? getDefaultRuntimeVersion(workflows.ios, exp.sdkVersion);

    if (platform === 'all' && isRuntimeEqual(androidRuntimeVersion, iosRuntimeVersion)) {
      modifyConfig.runtimeVersion = androidRuntimeVersion;
    } else {
      if (['all', 'android'].includes(platform)) {
        modifyConfig.runtimeVersion = undefined;
        modifyConfig.android = { runtimeVersion: androidRuntimeVersion };
      }
      if (['all', 'ios'].includes(platform)) {
        modifyConfig.runtimeVersion = undefined;
        modifyConfig.ios = { runtimeVersion: iosRuntimeVersion };
      }
    }
  }

  if (Object.keys(modifyConfig).length === 0) {
    return { exp, projectChanged: false };
  }

  const mergedExp = mergeExpoConfig(exp, modifyConfig);
  const result = await createOrModifyExpoConfigAsync(projectDir, mergedExp);

  switch (result.type) {
    case 'success':
      logEasUpdatesAutoConfig({ exp, modifyConfig });
      return {
        projectChanged: true,
        // TODO(cedric): fix return type of `modifyConfigAsync` to avoid `null` for type === success repsonses
        exp: result.config?.expo!,
      };

    case 'warn':
      warnEASUpdatesManualConfig({ modifyConfig, workflows });
      throw new Error(result.message);

    case 'fail':
      throw new Error(result.message);

    default:
      throw new Error(
        `Unexpected result type "${result.type}" received when modifying the project config.`
      );
  }
}

function serializeRuntimeVersionToString(
  runtimeVersion: NonNullable<ExpoConfig['runtimeVersion']>
): string {
  if (typeof runtimeVersion === 'object') {
    return JSON.stringify(runtimeVersion);
  } else {
    return runtimeVersion;
  }
}

function logEasUpdatesAutoConfig({
  modifyConfig,
  exp,
}: {
  modifyConfig: Partial<ExpoConfig>;
  exp: ExpoConfig;
}): void {
  if (modifyConfig.updates?.url) {
    Log.withTick(
      exp.updates?.url
        ? `Overwrote updates.url "${exp.updates.url}" with "${modifyConfig.updates.url}"`
        : `Configured updates.url to "${modifyConfig.updates.url}"`
    );
  }

  const androidRuntime = modifyConfig.android?.runtimeVersion ?? modifyConfig.runtimeVersion;
  const iosRuntime = modifyConfig.ios?.runtimeVersion ?? modifyConfig.runtimeVersion;
  if (androidRuntime && iosRuntime && androidRuntime === iosRuntime) {
    Log.withTick(
      `Configured runtimeVersion for ${appPlatformDisplayNames[AppPlatform.Android]} and ${
        appPlatformDisplayNames[AppPlatform.Ios]
      } with "${serializeRuntimeVersionToString(androidRuntime)}"`
    );
  } else {
    if (androidRuntime) {
      Log.withTick(
        `Configured runtimeVersion for ${
          appPlatformDisplayNames[AppPlatform.Android]
        } with "${serializeRuntimeVersionToString(androidRuntime)}"`
      );
    }
    if (iosRuntime) {
      Log.withTick(
        `Configured runtimeVersion for ${
          appPlatformDisplayNames[AppPlatform.Ios]
        } with "${serializeRuntimeVersionToString(iosRuntime)}"`
      );
    }
  }
}

function warnEASUpdatesManualConfig({
  modifyConfig,
  workflows,
}: {
  modifyConfig: Partial<ExpoConfig>;
  workflows: Record<Platform, Workflow>;
}): void {
  Log.addNewLineIfNone();
  Log.warn(
    `It looks like you are using a dynamic configuration! ${learnMore(
      'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs)'
    )}`
  );
  Log.warn(
    `Finish configuring EAS Update by adding the following to the project app.config.js:\n${learnMore(
      'https://expo.fyi/eas-update-config'
    )}\n`
  );

  Log.log(
    chalk.bold(
      JSON.stringify(replaceUndefinedObjectValues(modifyConfig, '<remove this key>'), null, 2)
    )
  );
  Log.addNewLineIfNone();

  if (workflows.android === Workflow.GENERIC || workflows.ios === Workflow.GENERIC) {
    Log.warn(
      chalk`The native config files {bold Expo.plist & AndroidManifest.xml} must be updated to support EAS Update. ${learnMore(
        'https://expo.fyi/eas-update-config.md#native-configuration'
      )}`
    );
  }

  Log.addNewLineIfNone();
}

/**
 * Make sure that the current `app.json` configuration for EAS Updates is set natively.
 */
async function ensureEASUpdateIsConfiguredNativelyAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    exp,
    projectId,
    projectDir,
    platform,
    workflows,
  }: {
    exp: ExpoConfig;
    projectId: string;
    projectDir: string;
    platform: RequestedPlatform;
    workflows: Record<Platform, Workflow>;
  }
): Promise<void> {
  if (['all', 'android'].includes(platform) && workflows.android === Workflow.GENERIC) {
    await syncAndroidUpdatesConfigurationAsync(graphqlClient, projectDir, exp, projectId);
    Log.withTick(`Configured ${chalk.bold('AndroidManifest.xml')} for EAS Update`);
  }

  if (['all', 'ios'].includes(platform) && workflows.ios === Workflow.GENERIC) {
    await syncIosUpdatesConfigurationAsync(graphqlClient, projectDir, exp, projectId);
    Log.withTick(`Configured ${chalk.bold('Expo.plist')} for EAS Update`);
  }
}

/**
 * Make sure EAS Build profiles are configured to work with EAS Update by adding channels to build profiles.
 */

export async function ensureEASUpdateIsConfiguredInEasJsonAsync(projectDir: string): Promise<void> {
  const easJsonPath = EasJsonAccessor.formatEasJsonPath(projectDir);

  if (!(await fs.pathExists(easJsonPath))) {
    Log.warn(
      `EAS Build is not configured. If you'd like to use EAS Build with EAS Update, run ${chalk.bold(
        'eas build:configure'
      )}.`
    );
    return;
  }

  try {
    const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
    await easJsonAccessor.readRawJsonAsync();

    easJsonAccessor.patch(easJsonRawObject => {
      const easBuildProfilesWithChannels = Object.keys(easJsonRawObject.build).reduce(
        (acc, profileNameKey) => {
          const buildProfile = easJsonRawObject.build[profileNameKey];
          const isNotAlreadyConfigured = !buildProfile.channel && !buildProfile.releaseChannel;

          if (isNotAlreadyConfigured) {
            return {
              ...acc,
              [profileNameKey]: {
                ...buildProfile,
                channel: profileNameKey,
              },
            };
          }

          return {
            ...acc,
            [profileNameKey]: {
              ...easJsonRawObject.build[profileNameKey],
            },
          };
        },
        {}
      );

      return {
        ...easJsonRawObject,
        build: easBuildProfilesWithChannels,
      };
    });

    await easJsonAccessor.writeAsync();
    Log.withTick(`Configured ${chalk.bold('eas.json')}.`);
  } catch (error) {
    Log.error(`We were not able to configure ${chalk.bold('eas.json')}. Error: ${error}.`);
  }
}

/**
 * Make sure EAS Update is fully configured in the current project.
 * This goes over a checklist and performs the following checks or changes:
 *   - Ensure `updates.useClassicUpdates` (SDK 49) is not set in the app config
 *   - Ensure the `expo-updates` package is currently installed.
 *   - Ensure `app.json` is configured for EAS Updates
 *     - Sets `runtimeVersion` if not set
 *     - Sets `updates.url` if not set
 *   - Ensure latest changes are reflected in the native config, if any
 */
export async function ensureEASUpdateIsConfiguredAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    exp: expMaybeWithoutUpdates,
    projectId,
    projectDir,
    vcsClient,
    platform,
  }: {
    exp: ExpoConfig;
    projectId: string;
    projectDir: string;
    vcsClient: Client;
    platform: RequestedPlatform | null;
  }
): Promise<void> {
  // EAS Update and SDK 49's "useClassicUpdates" option are mutually exclusive
  if (expMaybeWithoutUpdates.updates?.useClassicUpdates) {
    expMaybeWithoutUpdates = await ensureUseClassicUpdatesIsRemovedAsync({
      exp: expMaybeWithoutUpdates,
      projectDir,
    });
  }

  const hasExpoUpdates = isExpoUpdatesInstalledOrAvailable(
    projectDir,
    expMaybeWithoutUpdates.sdkVersion
  );
  const hasExpoUpdatesInDevDependencies = isExpoUpdatesInstalledAsDevDependency(projectDir);
  if (!hasExpoUpdates && !hasExpoUpdatesInDevDependencies) {
    await installExpoUpdatesAsync(projectDir, { silent: false });
    Log.withTick('Installed expo-updates');
  } else if (hasExpoUpdatesInDevDependencies) {
    Log.warn(
      `The "expo-updates" package is installed as a dev dependency. This is not recommended. Move "expo-updates" to your main dependencies.`
    );
  }

  // Bail out if using a platform that doesn't require runtime versions
  // or native setup, i.e. web.
  if (!platform) {
    return;
  }

  const workflows = await resolveWorkflowPerPlatformAsync(projectDir, vcsClient);
  const { projectChanged, exp: expWithUpdates } =
    await ensureEASUpdatesIsConfiguredInExpoConfigAsync({
      exp: expMaybeWithoutUpdates,
      projectDir,
      projectId,
      platform,
      workflows,
    });

  if (projectChanged || !hasExpoUpdates) {
    await ensureEASUpdateIsConfiguredNativelyAsync(graphqlClient, {
      exp: expWithUpdates,
      projectDir,
      projectId,
      platform,
      workflows,
    });
  }

  if (projectChanged) {
    Log.addNewLineIfNone();
    Log.warn(
      `All builds of your app going forward will be eligible to receive updates published with EAS Update.`
    );
    Log.newLine();
  }
}

export async function ensureUseClassicUpdatesIsRemovedAsync({
  exp: expMaybeWithoutUpdates,
  projectDir,
}: {
  exp: ExpoConfig;
  projectDir: string;
}): Promise<ExpoConfig> {
  if (!isUsingStaticExpoConfig(projectDir)) {
    throw new Error(
      `Your app config sets "updates.useClassicUpdates" but EAS Update does not support classic updates. Remove "useClassicUpdates" from your app config and run this command again.`
    );
  }

  const shouldEditConfig = await confirmAsync({
    message: `Your app config sets "updates.useClassicUpdates" but EAS Update does not support classic updates. Remove "updates.useClassicUpdates" from your app config?`,
  });
  if (!shouldEditConfig) {
    throw new Error(
      `Manually remove "updates.useClassicUpdates" from your app config and run this command again.`
    );
  }

  const editedExpoConfig = mergeExpoConfig(expMaybeWithoutUpdates, {
    updates: { useClassicUpdates: undefined },
  }) as ExpoConfig;
  const result = await createOrModifyExpoConfigAsync(projectDir, editedExpoConfig);

  switch (result.type) {
    case 'success':
      Log.withTick(`Removed "updates.useClassicUpdates"`);
      expMaybeWithoutUpdates = editedExpoConfig;
      break;

    case 'warn':
    case 'fail':
      throw new Error(result.message);

    default:
      throw new Error(
        `Unexpected result type "${result.type}" received when modifying the project config.`
      );
  }

  return editedExpoConfig;
}
