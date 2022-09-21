import { ExpoConfig, modifyConfigAsync } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import { getEASUpdateURL } from '../../api';
import EasCommand, { EASCommandProjectIdContext } from '../../commandUtils/EasCommand';
import { AppPlatform } from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { RequestedPlatform, appPlatformDisplayNames } from '../../platform';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  installExpoUpdatesAsync,
  isExpoUpdatesInstalledOrAvailable,
} from '../../project/projectUtils';
import { resolveWorkflowAsync } from '../../project/workflow';
import { syncUpdatesConfigurationAsync as syncAndroidUpdatesConfigurationAsync } from '../../update/android/UpdatesModule';
import { syncUpdatesConfigurationAsync as syncIosUpdatesConfigurationAsync } from '../../update/ios/UpdatesModule';

const DEFAULT_MANAGED_RUNTIME_VERSION = { policy: 'sdkVersion' } as const;
const DEFAULT_BARE_RUNTIME_VERSION = '1.0.0' as const;

export default class UpdateConfigure extends EasCommand {
  static override description = 'configure the project to support EAS Update';

  static override flags = {
    platform: Flags.enum({
      description: 'Platform to configure',
      char: 'p',
      options: ['android', 'ios', 'all'],
      default: 'all',
    }),
  };

  static override contextDefinition = {
    ...EASCommandProjectIdContext,
  };

  async runAsync(): Promise<void> {
    Log.log(
      '💡 The following process will configure your project to run EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );
    const { flags } = await this.parse(UpdateConfigure);
    const { projectId } = await this.getContextAsync(UpdateConfigure, {
      nonInteractive: true,
    });
    const platform = flags.platform as RequestedPlatform;
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);

    if (!isExpoUpdatesInstalledOrAvailable(projectDir, exp.sdkVersion)) {
      await installExpoUpdatesAsync(projectDir);
    }

    const [androidWorkflow, iosWorkflow] = await Promise.all([
      resolveWorkflowAsync(projectDir, Platform.ANDROID),
      resolveWorkflowAsync(projectDir, Platform.IOS),
    ]);

    const updatedExp = await configureAppJSONForEASUpdateAsync({
      projectDir,
      exp,
      platform,
      workflows: {
        android: androidWorkflow,
        ios: iosWorkflow,
      },
      projectId,
    });
    Log.withTick(`Configured ${chalk.bold('app.json')} for EAS Update`);

    // configure native files for EAS Update
    if (
      [RequestedPlatform.Android, RequestedPlatform.All].includes(platform) &&
      androidWorkflow === Workflow.GENERIC
    ) {
      await syncAndroidUpdatesConfigurationAsync(projectDir, updatedExp, { nonInteractive: true });
      Log.withTick(`Configured ${chalk.bold('AndroidManifest.xml')} for EAS Update`);
    }
    if (
      [RequestedPlatform.Ios, RequestedPlatform.All].includes(platform) &&
      iosWorkflow === Workflow.GENERIC
    ) {
      await syncIosUpdatesConfigurationAsync(projectDir, updatedExp, { nonInteractive: true });
      Log.withTick(`Configured ${chalk.bold('Expo.plist')} for EAS Update`);
    }

    Log.addNewLineIfNone();
    Log.log(`🎉 Your app is configured to run EAS Update!`);
  }
}

async function configureAppJSONForEASUpdateAsync({
  projectDir,
  exp,
  platform,
  workflows,
  projectId,
}: {
  projectDir: string;
  exp: ExpoConfig;
  platform: RequestedPlatform;
  workflows: {
    [key in RequestedPlatform.Android | RequestedPlatform.Ios]: Workflow;
  };
  projectId: string;
}): Promise<ExpoConfig> {
  // this command is non-interactive in the way it was designed
  const easUpdateURL = getEASUpdateURL(projectId);
  const updates = { ...exp.updates, url: easUpdateURL };

  const androidDefaultRuntimeVersion =
    workflows['android'] === Workflow.GENERIC
      ? DEFAULT_BARE_RUNTIME_VERSION
      : DEFAULT_MANAGED_RUNTIME_VERSION;
  const iosDefaultRuntimeVersion =
    workflows['ios'] === Workflow.GENERIC
      ? DEFAULT_BARE_RUNTIME_VERSION
      : DEFAULT_MANAGED_RUNTIME_VERSION;

  const newAndroidRuntimeVersion =
    exp.android?.runtimeVersion ?? exp.runtimeVersion ?? androidDefaultRuntimeVersion;
  const newIosRuntimeVersion =
    exp.ios?.runtimeVersion ?? exp.runtimeVersion ?? iosDefaultRuntimeVersion;

  let newConfig: Partial<ExpoConfig>;
  let newConfigOnlyAddedValues: Partial<ExpoConfig>;
  switch (platform) {
    case RequestedPlatform.All: {
      if (isRuntimeEqual(newAndroidRuntimeVersion, newIosRuntimeVersion)) {
        newConfig = {
          runtimeVersion: newAndroidRuntimeVersion,
          android: {
            ...exp.android,
            runtimeVersion: undefined,
          },
          ios: { ...exp.ios, runtimeVersion: undefined },
          updates,
        };
        newConfigOnlyAddedValues = {
          runtimeVersion: newAndroidRuntimeVersion,
          ...(exp.android && 'runtimeVersion' in exp.android
            ? {
                android: {
                  runtimeVersion: '<remove this key>',
                },
              }
            : {}),
          ...(exp.ios && 'runtimeVersion' in exp.ios
            ? {
                ios: {
                  runtimeVersion: '<remove this key>',
                },
              }
            : {}),
          updates: {
            url: easUpdateURL,
          },
        };
      } else {
        newConfig = {
          runtimeVersion: undefined, // top level runtime is redundant if it is specified in both android and ios
          android: {
            ...exp.android,
            runtimeVersion: newAndroidRuntimeVersion,
          },
          ios: {
            ...exp.ios,
            runtimeVersion: newIosRuntimeVersion,
          },
          updates,
        };
        newConfigOnlyAddedValues = {
          ...('runtimeVersion' in exp
            ? {
                runtimeVersion: '<remove this key>', // top level runtime is redundant if it is specified in both android and ios
              }
            : {}),
          android: {
            runtimeVersion: newAndroidRuntimeVersion,
          },
          ios: {
            runtimeVersion: newIosRuntimeVersion,
          },
          updates: {
            url: easUpdateURL,
          },
        };
      }
      break;
    }
    case RequestedPlatform.Android: {
      newConfig = {
        android: {
          ...exp.android,
          runtimeVersion: newAndroidRuntimeVersion,
        },
        updates,
      };
      newConfigOnlyAddedValues = {
        android: {
          runtimeVersion: newAndroidRuntimeVersion,
        },
        updates: {
          url: easUpdateURL,
        },
      };
      break;
    }
    case RequestedPlatform.Ios: {
      newConfig = {
        ios: {
          ...exp.ios,
          runtimeVersion: newIosRuntimeVersion,
        },
        updates,
      };
      newConfigOnlyAddedValues = {
        ios: {
          runtimeVersion: newIosRuntimeVersion,
        },
        updates: {
          url: easUpdateURL,
        },
      };
      break;
    }
    default: {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  const result = await modifyConfigAsync(projectDir, newConfig);

  const preexistingAndroidRuntimeVersion = exp.android?.runtimeVersion ?? exp.runtimeVersion;
  const preexistingIosRuntimeVersion = exp.ios?.runtimeVersion ?? exp.runtimeVersion;
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
        !preexistingAndroidRuntimeVersion &&
        [RequestedPlatform.Android, RequestedPlatform.All].includes(platform)
      ) {
        Log.withTick(
          `Set ${appPlatformDisplayNames[AppPlatform.Android]} runtimeVersion to "${JSON.stringify(
            newConfig.android?.runtimeVersion ?? newConfig.runtimeVersion
          )}" in app.json`
        );
      }
      if (
        !preexistingIosRuntimeVersion &&
        [RequestedPlatform.Ios, RequestedPlatform.All].includes(platform)
      ) {
        Log.withTick(
          `Set ${appPlatformDisplayNames[AppPlatform.Ios]} runtimeVersion to "${JSON.stringify(
            newConfig.ios?.runtimeVersion ?? newConfig.runtimeVersion
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
      Log.log(chalk.bold(JSON.stringify(newConfigOnlyAddedValues, null, 2)));
      Log.addNewLineIfNone();
      if (workflows['android'] === Workflow.GENERIC || workflows['ios'] === Workflow.GENERIC) {
        Log.warn(
          `You will also have to manually edit the projects ${chalk.bold(
            'Expo.plist/AndroidManifest.xml'
          )}. ${learnMore('https://expo.fyi/eas-update-config.md#native-configuration')}`
        );
      }
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

function isRuntimeEqual(
  runtimeVersionA: string | { policy: 'sdkVersion' | 'nativeVersion' | 'appVersion' },
  runtimeVersionB: string | { policy: 'sdkVersion' | 'nativeVersion' | 'appVersion' }
): boolean {
  if (typeof runtimeVersionA === 'string' && typeof runtimeVersionB === 'string') {
    return runtimeVersionA === runtimeVersionB;
  } else if (typeof runtimeVersionA === 'object' && typeof runtimeVersionB === 'object') {
    return runtimeVersionA.policy === runtimeVersionB.policy;
  } else {
    return false;
  }
}
