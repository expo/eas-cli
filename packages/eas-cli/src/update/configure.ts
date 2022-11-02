import { modifyConfigAsync } from '@expo/config';
import { ExpoConfig } from '@expo/config-types';
import { Platform, Workflow } from '@expo/eas-build-job';
import chalk from 'chalk';

import { getEASUpdateURL } from '../api';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../graphql/generated';
import Log, { learnMore } from '../log';
import { RequestedPlatform, appPlatformDisplayNames } from '../platform';
import {
  installExpoUpdatesAsync,
  isExpoUpdatesInstalledOrAvailable,
} from '../project/projectUtils';
import { resolveWorkflowPerPlatformAsync } from '../project/workflow';
import { syncUpdatesConfigurationAsync as syncAndroidUpdatesConfigurationAsync } from './android/UpdatesModule';
import { syncUpdatesConfigurationAsync as syncIosUpdatesConfigurationAsync } from './ios/UpdatesModule';

export const DEFAULT_MANAGED_RUNTIME_VERSION = { policy: 'sdkVersion' } as const;
export const DEFAULT_BARE_RUNTIME_VERSION = '1.0.0' as const;

function getDefaultRuntimeVersion(workflow: Workflow): NonNullable<ExpoConfig['runtimeVersion']> {
  return workflow === Workflow.GENERIC
    ? DEFAULT_BARE_RUNTIME_VERSION
    : DEFAULT_MANAGED_RUNTIME_VERSION;
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
    androidRuntimeVersion = androidRuntimeVersion ?? getDefaultRuntimeVersion(workflows.android);
    iosRuntimeVersion = iosRuntimeVersion ?? getDefaultRuntimeVersion(workflows.ios);

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
  const result = await modifyConfigAsync(projectDir, mergedExp);

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

  if (modifyConfig.android?.runtimeVersion ?? modifyConfig.runtimeVersion) {
    Log.withTick(
      `Configured runtimeVersion for ${
        appPlatformDisplayNames[AppPlatform.Android]
      } with "${JSON.stringify(
        modifyConfig.android?.runtimeVersion ?? modifyConfig.runtimeVersion
      )}"`
    );
  }

  if (modifyConfig.ios?.runtimeVersion ?? modifyConfig.runtimeVersion) {
    Log.withTick(
      `Configured runtimeVersion for ${
        appPlatformDisplayNames[AppPlatform.Ios]
      } with "${JSON.stringify(modifyConfig.ios?.runtimeVersion ?? modifyConfig.runtimeVersion)}"`
    );
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
async function ensureEASUpdatesIsConfiguredNativelyAsync(
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
 * Make sure EAS Update is fully configured in the current project.
 * This goes over a checklist and performs the following checks or changes:
 *   - Enure the `expo-updates` package is currently installed.
 *   - Ensure `app.json` is configured for EAS Updates
 *     - Sets `runtimeVersion` if not set
 *     - Sets `updates.url` if not set
 *   - Ensure latest changes are reflected in the native config, if any
 */
export async function ensureEASUpdatesIsConfiguredAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    exp: expWithoutUpdates,
    projectId,
    projectDir,
    platform,
  }: {
    exp: ExpoConfig;
    projectId: string;
    projectDir: string;
    platform: RequestedPlatform;
  }
): Promise<void> {
  const hasExpoUpdates = isExpoUpdatesInstalledOrAvailable(
    projectDir,
    expWithoutUpdates.sdkVersion
  );
  if (!hasExpoUpdates) {
    await installExpoUpdatesAsync(projectDir, { silent: !Log.isDebug });
    Log.withTick('Installed expo updates');
  }

  const workflows = await resolveWorkflowPerPlatformAsync(projectDir);
  const { projectChanged, exp: expWithUpdates } =
    await ensureEASUpdatesIsConfiguredInExpoConfigAsync({
      exp: expWithoutUpdates,
      projectDir,
      projectId,
      platform,
      workflows,
    });

  if (projectChanged || !hasExpoUpdates) {
    await ensureEASUpdatesIsConfiguredNativelyAsync(graphqlClient, {
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
