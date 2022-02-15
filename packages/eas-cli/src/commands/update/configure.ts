import { ExpoConfig, getConfig, modifyConfigAsync } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import { getEASUpdateURL } from '../../api';
import { syncUpdatesConfigurationAsync as syncAndroidUpdatesConfigurationAsync } from '../../build/android/UpdatesModule';
import { syncUpdatesConfigurationAsync as syncIosUpdatesConfigurationAsync } from '../../build/ios/UpdatesModule';
import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore } from '../../log';
import { RequestedPlatform } from '../../platform';
import {
  findProjectRootAsync,
  getProjectIdAsync,
  installExpoUpdatesAsync,
  isExpoUpdatesInstalledOrAvailable,
} from '../../project/projectUtils';
import { resolveWorkflowAsync } from '../../project/workflow';

const DEFAULT_MANAGED_RUNTIME_VERSION = { policy: 'sdkVersion' } as const;
const DEFAULT_BARE_RUNTIME_VERSION = '1.0.0';

async function configureProjectForEASUpdateAsync(
  projectDir: string,
  exp: ExpoConfig,
  isBare: { ios: boolean; android: boolean },
  platform: RequestedPlatform
): Promise<ExpoConfig> {
  const projectId = await getProjectIdAsync(exp);
  const easUpdateURL = getEASUpdateURL(projectId);

  const prexistingAndroidRuntimeVersion = exp.android?.runtimeVersion ?? exp.runtimeVersion;
  const prexistingIosRuntimeVersion = exp.ios?.runtimeVersion ?? exp.runtimeVersion;
  const defaultIosRuntimeVersion = isBare['ios']
    ? DEFAULT_BARE_RUNTIME_VERSION
    : DEFAULT_MANAGED_RUNTIME_VERSION;
  const defaultAndroidRuntimeVersion = isBare['android']
    ? DEFAULT_BARE_RUNTIME_VERSION
    : DEFAULT_MANAGED_RUNTIME_VERSION;

  const updates = { ...exp.updates, url: easUpdateURL };

  let result;
  switch (platform) {
    case RequestedPlatform.All: {
      result = await modifyConfigAsync(projectDir, {
        runtimeVersion: undefined,
        android: {
          ...exp.android,
          runtimeVersion: prexistingAndroidRuntimeVersion ?? defaultAndroidRuntimeVersion,
        },
        ios: {
          ...exp.ios,
          runtimeVersion: prexistingIosRuntimeVersion ?? defaultIosRuntimeVersion,
        },
        updates,
      });
      break;
    }
    case RequestedPlatform.Android: {
      result = await modifyConfigAsync(projectDir, {
        android: {
          ...exp.android,
          runtimeVersion: prexistingAndroidRuntimeVersion ?? defaultAndroidRuntimeVersion,
        },
        updates,
      });
      break;
    }
    case RequestedPlatform.Ios: {
      result = await modifyConfigAsync(projectDir, {
        ios: {
          ...exp.ios,
          runtimeVersion: prexistingIosRuntimeVersion ?? defaultIosRuntimeVersion,
        },
        updates,
      });
      break;
    }
    default: {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  switch (result.type) {
    case 'success':
      if (exp.updates?.url) {
        if (exp.updates.url !== easUpdateURL) {
          Log.withTick(
            `Overwrote "${exp.updates?.url}" with "${easUpdateURL}" for the updates.url value in app.json`
          );
        }
      } else {
        Log.withTick(`Set updates.url value, to "${easUpdateURL}" in app.json`);
      }
      if (!prexistingAndroidRuntimeVersion) {
        Log.withTick(
          `Set Android runtimeVersion to "${JSON.stringify(
            defaultAndroidRuntimeVersion
          )}" in app.json`
        );
      }
      if (!prexistingIosRuntimeVersion) {
        Log.withTick(
          `Set IOS runtimeVersion to "${JSON.stringify(defaultIosRuntimeVersion)}" in app.json`
        );
      }

      break;
    case 'warn': {
      Log.addNewLineIfNone();
      Log.warn(
        `It looks like you are using a dynamic configuration! ${learnMore(
          'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs)'
        )}`
      );
      Log.warn(
        `In order to finish configuring your project for EAS Update, you are going to need manually add the following to your app.config.js:\n${learnMore(
          'https://expo.fyi/eas-update-config.md'
        )}\n`
      );
      Log.log(
        chalk.bold(
          `{\n  "updates": {\n    "url": "${easUpdateURL}"\n  },\n  "runtimeVersion": {\n    "policy": "sdkVersion"\n  }\n}`
        )
      );
      Log.addNewLineIfNone();
      throw new Error(result.message);
    }
    case 'fail':
      throw new Error(result.message);
    default:
      throw new Error('Unexpected result type from modifyConfigAsync');
  }
  assert(result.config, 'A successful result should have a config');

  return result.config.expo;
}

export default class UpdateConfigure extends EasCommand {
  static description = 'configure the project to support EAS Update';

  static flags = {
    platform: Flags.enum({
      description: 'Platform to configure',
      char: 'p',
      options: ['android', 'ios', 'all'],
      default: 'all',
    }),
  };

  async runAsync(): Promise<void> {
    Log.log(
      '💡 The following process will configure your project to run EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );

    const { flags } = await this.parse(UpdateConfigure);
    const platform = flags.platform as RequestedPlatform;

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
    });

    const hasAndroidNativeProject =
      (await resolveWorkflowAsync(projectDir, Platform.ANDROID)) === Workflow.GENERIC;
    const hasIosNativeProject =
      (await resolveWorkflowAsync(projectDir, Platform.IOS)) === Workflow.GENERIC;

    // ensure expo-updates is installed
    if (!isExpoUpdatesInstalledOrAvailable(projectDir, exp.sdkVersion)) {
      await installExpoUpdatesAsync(projectDir);
    }

    // configure app.json for EAS Update
    const updatedExp = await configureProjectForEASUpdateAsync(
      projectDir,
      exp,
      { android: hasIosNativeProject, ios: hasIosNativeProject },
      platform
    );

    // configure native files for EAS Update
    const nativeFilesToSync = [];
    if (
      [RequestedPlatform.Android, RequestedPlatform.All].includes(platform) &&
      hasAndroidNativeProject
    ) {
      nativeFilesToSync.push(syncAndroidUpdatesConfigurationAsync(projectDir, updatedExp));
    }
    if ([RequestedPlatform.Ios, RequestedPlatform.All].includes(platform) && hasIosNativeProject) {
      nativeFilesToSync.push(syncIosUpdatesConfigurationAsync(projectDir, updatedExp));
    }

    Log.addNewLineIfNone();
    if (nativeFilesToSync.length > 0) {
      await Promise.all(nativeFilesToSync);
    } else {
      Log.log(`🎉 Your app is configured to run EAS Update!`);
    }
  }
}
