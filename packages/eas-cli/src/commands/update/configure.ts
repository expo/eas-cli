import { ExpoConfig, getConfig, modifyConfigAsync } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore } from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { resolveWorkflowAsync } from '../../project/workflow';

const EAS_UPDATE_URL = 'https://u.expo.dev';

export async function getEASUpdateURLAsync(exp: ExpoConfig): Promise<string> {
  const projectId = await getProjectIdAsync(exp);
  return new URL(projectId, EAS_UPDATE_URL).href;
}

async function ensureEASUrlSetAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  const easUpdateURL = await getEASUpdateURLAsync(exp);
  const currentURL = exp.updates?.url;
  if (currentURL) {
    Log.warn(
      `Overwriting current updates.url value, "${currentURL}", with "${easUpdateURL}" in app.json`
    );
  }

  const result = await modifyConfigAsync(projectDir, {
    updates: { ...exp.updates, url: easUpdateURL },
  });

  switch (result.type) {
    case 'success':
      break;
    case 'warn': {
      Log.log();
      Log.warn('It looks like you are using a dynamic configuration!');
      Log.log(
        chalk.dim(
          'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs)\n'
        )
      );
      Log.warn(
        'In order to finish configuring your project for EAS Update, you are going to need manually add the following to your "extra" key:\n\n'
      );
      Log.log(chalk.bold(`"updates": {\n    "url": "${easUpdateURL}"\n  }`));
      throw new Error(result.message);
    }
    case 'fail':
      throw new Error(result.message);
    default:
      throw new Error('Unexpected result type from modifyConfigAsync');
  }
}

export default class UpdateConfigure extends EasCommand {
  static description = 'Configure the project to support EAS Update.';

  async runAsync(): Promise<void> {
    Log.log(
      '💡 The following process will configure your project to to run EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );
    Log.newLine();

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
    });

    await ensureEASUrlSetAsync(projectDir, exp);

    const hasAndroidNativeProject =
      (await resolveWorkflowAsync(projectDir, Platform.ANDROID)) === Workflow.GENERIC;
    const hasIosNativeProject =
      (await resolveWorkflowAsync(projectDir, Platform.IOS)) === Workflow.GENERIC;

    Log.addNewLineIfNone();
    if (hasAndroidNativeProject || hasIosNativeProject) {
      Log.log(
        `🧐 It seems like you are on the bare workflow! Please be sure to also update your native files as well. You can do the by running 'eas build:configure' or manually editing the Expo.plist/AndroidManifest.xml. For details check: ${learnMore(
          'https://expo.fyi/configure-eas-update'
        )}`
      );
    } else {
      Log.log(`🎉 Your app is configured to run EAS Update!`);
    }
  }
}
