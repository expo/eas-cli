import { Workflow } from '@expo/eas-build-job';
import { Errors } from '@oclif/core';
import chalk from 'chalk';
import resolveFrom from 'resolve-from';

import { reviewAndCommitChangesAsync } from './repository';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log, { learnMore } from '../../log';
import { appPlatformDisplayNames } from '../../platform';
import { resolveWorkflowAsync } from '../../project/workflow';
import { confirmAsync } from '../../prompts';
import { expoCommandAsync } from '../../utils/expoCli';
import { ProfileData } from '../../utils/profiles';
import { Client } from '../../vcs/vcs';

export async function ensureExpoDevClientInstalledForDevClientBuildsAsync({
  projectDir,
  vcsClient,
  nonInteractive = false,
  buildProfiles = [],
}: {
  projectDir: string;
  vcsClient: Client;
  nonInteractive?: boolean;
  buildProfiles?: ProfileData<'build'>[];
}): Promise<void> {
  if (isExpoDevClientInstalled(projectDir)) {
    return;
  }

  const buildProfilesWithDevelopmentClientRequired = buildProfiles.filter(
    buildProfile => buildProfile.profile.developmentClient
  );

  const isDevelopmentClientRequired = buildProfilesWithDevelopmentClientRequired.some(Boolean);

  if (!isDevelopmentClientRequired) {
    return;
  }

  const platformsToCheck = buildProfilesWithDevelopmentClientRequired.map(
    ({ platform }) => platform
  );

  const workflowPerPlatformList = await Promise.all(
    platformsToCheck.map(platform => resolveWorkflowAsync(projectDir, platform, vcsClient))
  );

  Log.newLine();
  Log.error(
    `You want to build a development client build for platforms: ${platformsToCheck
      .map(i => chalk.bold(appPlatformDisplayNames[toAppPlatform(i)]))
      .join(', ')}`
  );
  Log.error(
    `However, we detected that you don't have ${chalk.bold(
      'expo-dev-client'
    )} installed for your project.`
  );
  if (nonInteractive) {
    Log.error(`You'll need to install ${chalk.bold('expo-dev-client')} manually.`);
    Log.error(
      learnMore('https://docs.expo.dev/clients/installation/', {
        learnMoreMessage: 'See installation instructions on how to do it.',
        dim: false,
      })
    );
    Errors.error(`Install ${chalk.bold('expo-dev-client')} manually and try again later.`, {
      exit: 1,
    });
  }

  const areAllManaged = workflowPerPlatformList.every(i => i === Workflow.MANAGED);
  if (areAllManaged) {
    const install = await confirmAsync({
      message: 'Do you want EAS CLI to install expo-dev-client for you?',
      instructions: 'The command will abort unless you agree.',
    });
    if (install) {
      await installExpoDevClientAsync(projectDir, vcsClient, { nonInteractive });
    } else {
      Errors.error(`Install ${chalk.bold('expo-dev-client')} manually and come back later.`, {
        exit: 1,
      });
    }
  } else {
    Log.warn(`You'll need to install ${chalk.bold('expo-dev-client')} manually.`);
    Log.warn(
      learnMore('https://docs.expo.dev/clients/installation/', {
        learnMoreMessage: 'See installation instructions on how to do it.',
        dim: false,
      })
    );
    Log.warn('If you proceed anyway, you might not get the build you want.');
    Log.newLine();
    const shouldContinue = await confirmAsync({
      message: 'Do you want to proceed anyway?',
      initial: false,
    });
    if (!shouldContinue) {
      Errors.error('Come back later', { exit: 1 });
    }
  }
}

export function isExpoDevClientInstalled(projectDir: string): boolean {
  try {
    resolveFrom(projectDir, 'expo-dev-client/package.json');
    return true;
  } catch (err: any) {
    Log.debug(err);
    return false;
  }
}

async function installExpoDevClientAsync(
  projectDir: string,
  vcsClient: Client,
  { nonInteractive }: { nonInteractive: boolean }
): Promise<void> {
  Log.newLine();
  Log.log(`Running ${chalk.bold('expo install expo-dev-client')}`);
  Log.newLine();
  await expoCommandAsync(projectDir, ['install', 'expo-dev-client']);
  Log.newLine();
  if (await vcsClient.isCommitRequiredAsync()) {
    await reviewAndCommitChangesAsync(vcsClient, 'Install expo-dev-client', {
      nonInteractive,
    });
  }
}
