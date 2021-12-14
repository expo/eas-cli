import { ExpoConfig, getConfig, modifyConfigAsync } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore } from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { resolveWorkflowAsync } from '../../project/workflow';

const EAS_UPDATE_URL_PROD = 'https://u.expo.dev';
const EAS_UPDATE_URL_STAGING = 'https://staging-u.expo.dev';
const EAS_UPDATE_URL_LOCAL = 'http://localhost:3000';
const DEFAULT_MANAGED_RUNTIME_VERSION = { policy: 'sdkVersion' } as const;
const DEFAULT_BARE_RUNTIME_VERSION = '1.0.0';

export async function getEASUpdateURLAsync(exp: ExpoConfig): Promise<string> {
  const projectId = await getProjectIdAsync(exp);
  if (process.env.EXPO_LOCAL) {
    return new URL(`expo-updates/${projectId}`, EAS_UPDATE_URL_LOCAL).href;
  } else if (process.env.EXPO_STAGING) {
    return new URL(projectId, EAS_UPDATE_URL_STAGING).href;
  } else {
    return new URL(projectId, EAS_UPDATE_URL_PROD).href;
  }
}

async function configureProjectForEASUpdateAsync(
  projectDir: string,
  exp: ExpoConfig,
  isBare: boolean
): Promise<void> {
  const easUpdateURL = await getEASUpdateURLAsync(exp);
  const preexistingRuntimeVersion = exp.runtimeVersion;
  const defaultRuntimeVersion = isBare
    ? DEFAULT_BARE_RUNTIME_VERSION
    : DEFAULT_MANAGED_RUNTIME_VERSION;
  const result = await modifyConfigAsync(projectDir, {
    runtimeVersion: preexistingRuntimeVersion ?? defaultRuntimeVersion,
    updates: { ...exp.updates, url: easUpdateURL },
  });

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
      if (!preexistingRuntimeVersion) {
        Log.withTick(
          `Set runtimeVersion to "${JSON.stringify(defaultRuntimeVersion)}" in app.json`
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
          `{\n  updates": {\n    "url": "${easUpdateURL}"\n  },\n  "runtimeVersion": {\n    "policy": "sdkVersion"\n  }\n}`
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
}

export default class UpdateConfigure extends EasCommand {
  static hidden = true;
  static description = 'Configure the project to support EAS Update.';

  async runAsync(): Promise<void> {
    Log.log(
      '💡 The following process will configure your project to run EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
    });

    const hasAndroidNativeProject =
      (await resolveWorkflowAsync(projectDir, Platform.ANDROID)) === Workflow.GENERIC;
    const hasIosNativeProject =
      (await resolveWorkflowAsync(projectDir, Platform.IOS)) === Workflow.GENERIC;
    const isBare = hasAndroidNativeProject || hasIosNativeProject;

    await configureProjectForEASUpdateAsync(projectDir, exp, isBare);

    Log.addNewLineIfNone();
    if (isBare) {
      Log.log(
        `🧐 It seems you are on the bare workflow! Please also update your native files. You can do this by either running ${chalk.bold(
          'eas build:configure'
        )} or manually editing Expo.plist/AndroidManifest.xml. ${learnMore(
          'https://expo.fyi/eas-update-config.md#native-configuration'
        )}`
      );
    } else {
      Log.log(`🎉 Your app is configured to run EAS Update!`);
    }
  }
}
