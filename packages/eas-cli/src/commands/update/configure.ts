import { ExpoConfig, getConfig, modifyConfigAsync } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import { getEASUpdateURL } from '../../api';
import EasCommand from '../../commandUtils/EasCommand';
import { AppPlatform } from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { RequestedPlatform, appPlatformDisplayNames } from '../../platform';
import {
  findProjectRootAsync,
  getProjectIdAsync,
  installExpoUpdatesAsync,
  isExpoUpdatesInstalledOrAvailable,
} from '../../project/projectUtils';
import { resolveWorkflowAsync } from '../../project/workflow';
import { syncUpdatesConfigurationAsync as syncAndroidUpdatesConfigurationAsync } from '../../update/android/UpdatesModule';
import { syncUpdatesConfigurationAsync as syncIosUpdatesConfigurationAsync } from '../../update/ios/UpdatesModule';

const DEFAULT_MANAGED_RUNTIME_VERSION = { policy: 'sdkVersion' } as const;
const DEFAULT_BARE_RUNTIME_VERSION = '1.0.0';

async function configureAppJSONForEASUpdateAsync({
  projectDir,
  exp,
  platform,
  defaultRuntimeVersions,
}: {
  projectDir: string;
  exp: ExpoConfig;
  platform: RequestedPlatform;
  defaultRuntimeVersions: {
    [key in RequestedPlatform.Android | RequestedPlatform.Ios]:
      | string
      | {
          policy: 'sdkVersion';
        };
  };
}): Promise<ExpoConfig> {
  const projectId = await getProjectIdAsync(exp);
  const easUpdateURL = getEASUpdateURL(projectId);
  const updates = { ...exp.updates, url: easUpdateURL };

  const prexistingAndroidRuntimeVersion = exp.android?.runtimeVersion ?? exp.runtimeVersion;
  const android = {
    ...exp.android,
    runtimeVersion: prexistingAndroidRuntimeVersion ?? defaultRuntimeVersions['android'],
  };

  const prexistingIosRuntimeVersion = exp.ios?.runtimeVersion ?? exp.runtimeVersion;
  const ios = {
    ...exp.ios,
    runtimeVersion: prexistingIosRuntimeVersion ?? defaultRuntimeVersions['ios'],
  };

  let result;
  switch (platform) {
    case RequestedPlatform.All: {
      result = await modifyConfigAsync(projectDir, {
        runtimeVersion: undefined, // top level runtime is redundant if it is specified in both android and ios
        android,
        ios,
        updates,
      });
      break;
    }
    case RequestedPlatform.Android: {
      result = await modifyConfigAsync(projectDir, {
        android,
        updates,
      });
      break;
    }
    case RequestedPlatform.Ios: {
      result = await modifyConfigAsync(projectDir, {
        ios,
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

      if (
        !prexistingAndroidRuntimeVersion &&
        [RequestedPlatform.Android, RequestedPlatform.All].includes(platform)
      ) {
        Log.withTick(
          `Set ${appPlatformDisplayNames[AppPlatform.Android]} runtimeVersion to "${JSON.stringify(
            defaultRuntimeVersions['android']
          )}" in app.json`
        );
      }
      if (
        !prexistingIosRuntimeVersion &&
        [RequestedPlatform.Ios, RequestedPlatform.All].includes(platform)
      ) {
        Log.withTick(
          `Set ${appPlatformDisplayNames[AppPlatform.Ios]} runtimeVersion to "${JSON.stringify(
            defaultRuntimeVersions['ios']
          )}" in app.json`
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

    if (!isExpoUpdatesInstalledOrAvailable(projectDir, exp.sdkVersion)) {
      await installExpoUpdatesAsync(projectDir);
    }

    const [androidWorkflow, iosWorkflow] = await Promise.all([
      resolveWorkflowAsync(projectDir, Platform.ANDROID),
      resolveWorkflowAsync(projectDir, Platform.IOS),
    ]);

    const defaultRuntimeVersions = {
      android:
        androidWorkflow === Workflow.GENERIC
          ? DEFAULT_BARE_RUNTIME_VERSION
          : DEFAULT_MANAGED_RUNTIME_VERSION,
      ios:
        iosWorkflow === Workflow.GENERIC
          ? DEFAULT_BARE_RUNTIME_VERSION
          : DEFAULT_MANAGED_RUNTIME_VERSION,
    };
    const updatedExp = await configureAppJSONForEASUpdateAsync({
      projectDir,
      exp,
      platform,
      defaultRuntimeVersions,
    });

    // configure native files for EAS Update
    const nativeFilesToSync = [];
    if (
      [RequestedPlatform.Android, RequestedPlatform.All].includes(platform) &&
      androidWorkflow === Workflow.GENERIC
    ) {
      nativeFilesToSync.push(syncAndroidUpdatesConfigurationAsync(projectDir, updatedExp));
    }
    if (
      [RequestedPlatform.Ios, RequestedPlatform.All].includes(platform) &&
      iosWorkflow === Workflow.GENERIC
    ) {
      nativeFilesToSync.push(syncIosUpdatesConfigurationAsync(projectDir, updatedExp));
    }
    await Promise.all(nativeFilesToSync);

    Log.addNewLineIfNone();
    Log.log(`🎉 Your app is configured to run EAS Update!`);
  }
}
