import { Platform, Workflow } from '@expo/eas-build-job';
import { EasJsonReader } from '@expo/eas-json';
import { error } from '@oclif/errors';
import chalk from 'chalk';
import resolveFrom from 'resolve-from';

import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log from '../../log';
import { appPlatformDisplayNames } from '../../platform';
import { resolveWorkflowAsync } from '../../project/workflow';
import { confirmAsync } from '../../prompts';
import { expoCommandAsync } from '../../utils/expoCommand';
import zipObject from '../../utils/expodash/zipObject';
import { reviewAndCommitChangesAsync } from './repository';

export async function ensureExpoDevClientInstalledForDevClientBuildsAsync({
  projectDir,
  platforms,
  profile,
  nonInteractive = false,
}: {
  projectDir: string;
  platforms: Platform[];
  profile: string;
  nonInteractive?: boolean;
}): Promise<void> {
  if (await isExpoDevClientInstalledAsync(projectDir)) {
    return;
  }

  const easJsonReader = new EasJsonReader(projectDir);
  const devClientPerPlatformList = await Promise.all(
    platforms.map(async platform => {
      const buildProfile = await easJsonReader.readBuildProfileAsync(platform, profile);
      return buildProfile.developmentClient ?? false;
    })
  );

  const isDevClientRequired = devClientPerPlatformList.some(i => i);
  if (!isDevClientRequired) {
    return;
  }

  const devClientPerPlatform = zipObject(platforms, devClientPerPlatformList);
  const platformsToCheck = platforms.filter(platform => devClientPerPlatform[platform]);
  const workflowPerPlatformList = await Promise.all(
    platformsToCheck.map(platform => resolveWorkflowAsync(projectDir, platform))
  );

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
      error(`Install ${chalk.bold('expo-dev-client')} on your own and come back later.`, {
        exit: 1,
      });
    }
  } else {
    Log.warn(`Unfortunately, you need to install ${chalk.bold('expo-dev-client')} on your own.`);
    Log.warn('If you proceed anyway, you might not get the build you want.');
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
