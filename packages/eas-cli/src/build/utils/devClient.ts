import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import { error } from '@oclif/errors';
import chalk from 'chalk';
import resolveFrom from 'resolve-from';

import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log, { learnMore } from '../../log';
import { appPlatformDisplayNames } from '../../platform';
import { resolveWorkflowAsync } from '../../project/workflow';
import { confirmAsync } from '../../prompts';
import { expoCommandAsync } from '../../utils/expoCommand';
import { ProfileData } from '../../utils/profiles';
import { reviewAndCommitChangesAsync } from './repository';

export async function ensureExpoDevClientInstalledForDevClientBuildsAsync({
  projectDir,
  nonInteractive = false,
  buildProfiles = [],
}: {
  projectDir: string;
  nonInteractive?: boolean;
  buildProfiles?: ProfileData<BuildProfile>[];
}): Promise<void> {
  if (await isExpoDevClientInstalledAsync(projectDir)) {
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
    ({ platform }: ProfileData<BuildProfile>) => platform
  );

  const workflowPerPlatformList = await Promise.all(
    platformsToCheck.map(platform => resolveWorkflowAsync(projectDir, platform))
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
  const areAllManaged = workflowPerPlatformList.every(i => i === Workflow.MANAGED);
  if (areAllManaged) {
    const install = await confirmAsync({
      message: 'Do you want EAS CLI to install expo-dev-client for you?',
      instructions: 'The command will abort unless you agree.',
    });
    if (install) {
      await installExpoDevClientAsync(projectDir, { nonInteractive });
    } else {
      error(`Install ${chalk.bold('expo-dev-client')} manually and come back later.`, {
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
      error('Come back later', { exit: 1 });
    }
  }
}

async function isExpoDevClientInstalledAsync(projectDir: string): Promise<boolean> {
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
  { nonInteractive }: { nonInteractive: boolean }
): Promise<void> {
  Log.newLine();
  Log.log(`Running ${chalk.bold('expo install expo-dev-client')}`);
  Log.newLine();
  await expoCommandAsync(projectDir, ['install', 'expo-dev-client']);
  Log.newLine();
  await reviewAndCommitChangesAsync('Install expo-dev-client', {
    nonInteractive,
  });
}
