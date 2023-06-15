import { Platform, Workflow } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { getEASUpdateURL } from '../../api';
import { cleanUpOldEasBuildGradleScriptAsync } from '../../build/android/syncProjectConfiguration';
import { ensureProjectConfiguredAsync } from '../../build/configure';
import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore } from '../../log';
import { RequestedPlatform } from '../../platform';
import { isExpoUpdatesInstalled } from '../../project/projectUtils';
import { resolveWorkflowAsync } from '../../project/workflow';
import { promptAsync } from '../../prompts';
import { syncUpdatesConfigurationAsync as syncAndroidUpdatesConfigurationAsync } from '../../update/android/UpdatesModule';
import { ensureEASUpdateIsConfiguredInEasJsonAsync } from '../../update/configure';
import { syncUpdatesConfigurationAsync as syncIosUpdatesConfigurationAsync } from '../../update/ios/UpdatesModule';
import { getVcsClient } from '../../vcs';

export default class BuildConfigure extends EasCommand {
  static override description = 'configure the project to support EAS Build';

  static override flags = {
    platform: Flags.enum({
      description: 'Platform to configure',
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildConfigure);
    const {
      privateProjectConfig: { exp, projectId, projectDir },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildConfigure, {
      nonInteractive: false,
    });

    Log.log(
      '💡 The following process will configure your iOS and/or Android project to be compatible with EAS Build. These changes only apply to your local project files and you can safely revert them at any time.'
    );

    await getVcsClient().ensureRepoExistsAsync();

    const expoUpdatesIsInstalled = isExpoUpdatesInstalled(projectDir);

    const platform =
      (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());

    // clean up old Android configuration
    if ([RequestedPlatform.Android, RequestedPlatform.All].includes(platform)) {
      await cleanUpOldEasBuildGradleScriptAsync(projectDir);
    }

    // ensure eas.json exists
    Log.newLine();
    await ensureProjectConfiguredAsync({
      projectDir,
      nonInteractive: false,
    });

    // configure expo-updates
    if (expoUpdatesIsInstalled) {
      if ([RequestedPlatform.Android, RequestedPlatform.All].includes(platform)) {
        const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
        if (workflow === Workflow.GENERIC) {
          await syncAndroidUpdatesConfigurationAsync(graphqlClient, projectDir, exp, projectId);
        }
      }

      if ([RequestedPlatform.Ios, RequestedPlatform.All].includes(platform)) {
        const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS);
        if (workflow === Workflow.GENERIC) {
          await syncIosUpdatesConfigurationAsync(graphqlClient, projectDir, exp, projectId);
        }
      }

      // configure for EAS Update
      if (exp.updates?.url === getEASUpdateURL(projectId)) {
        await ensureEASUpdateIsConfiguredInEasJsonAsync(projectDir);
      }
    }

    Log.addNewLineIfNone();

    Log.log(`🎉 Your project is ready to build.

- Run ${chalk.bold('eas build')} when you are ready to create your first build.
- Once the build is completed, run ${chalk.bold('eas submit')} to upload the app to app stores.
- ${learnMore('https://docs.expo.dev/build/introduction', {
      learnMoreMessage: 'Learn more about other capabilities of EAS Build',
    })}`);
  }
}

async function promptForPlatformAsync(): Promise<RequestedPlatform> {
  Log.addNewLineIfNone();
  const { platform } = await promptAsync({
    type: 'select',
    message: 'Which platforms would you like to configure for EAS Build?',
    name: 'platform',
    choices: [
      {
        title: 'All',
        value: RequestedPlatform.All,
      },
      {
        title: 'iOS',
        value: RequestedPlatform.Ios,
      },
      {
        title: 'Android',
        value: RequestedPlatform.Android,
      },
    ],
  });
  return platform;
}
