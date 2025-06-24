import { Workflow } from '@expo/eas-build-job';
import chalk from 'chalk';
import getenv from 'getenv';
import resolveFrom from 'resolve-from';

import { resolveWorkflowPerPlatformAsync } from './workflow';
import Log, { learnMore } from '../log';
import type { ProfileData } from '../utils/profiles';
import type { Client } from '../vcs/vcs';

const suppressionEnvVarName = 'EAS_BUILD_NO_EXPO_GO_WARNING';

export const discourageExpoGoForProd = (
  buildProfiles: ProfileData<'build'>[] | undefined,
  projectDir: string,
  vcsClient: Client
): void => {
  detectExpoGoProdBuildAsync(buildProfiles, projectDir, vcsClient)
    .then(usesExpoGo => {
      if (usesExpoGo) {
        Log.newLine();
        Log.warn(
          `⚠️ It appears you're trying to build an app based on Expo Go for production. Expo Go is not a suitable environment for production apps.`
        );
        Log.warn(
          learnMore('https://docs.expo.dev/develop/development-builds/expo-go-to-dev-build/', {
            learnMoreMessage: 'Learn more about converting from Expo Go to a development build',
            dim: false,
          })
        );
        Log.warn(
          chalk.dim(`To suppress this warning, set ${chalk.bold(`${suppressionEnvVarName}=true`)}.`)
        );
        Log.newLine();
      }
    })
    .catch(err => {
      Log.warn('Error detecting whether Expo Go is used:', err);
    });
};

export async function detectExpoGoProdBuildAsync(
  buildProfiles: ProfileData<'build'>[] | undefined,
  projectDir: string,
  vcsClient: Client
): Promise<boolean> {
  const shouldSuppressWarning = getenv.boolish(suppressionEnvVarName, false);

  const isProductionBuild = buildProfiles?.map(it => it.profileName).includes('production');
  if (shouldSuppressWarning || !isProductionBuild) {
    return false;
  }

  const hasExpoDevClient = checkIfExpoDevClientInstalled(projectDir);
  if (hasExpoDevClient) {
    return false;
  }

  return await checkIfManagedWorkflowAsync(projectDir, vcsClient);
}

async function checkIfManagedWorkflowAsync(
  projectDir: string,
  vcsClient: Client
): Promise<boolean> {
  const workflows = await resolveWorkflowPerPlatformAsync(projectDir, vcsClient);

  return workflows.android === Workflow.MANAGED && workflows.ios === Workflow.MANAGED;
}

function checkIfExpoDevClientInstalled(projectDir: string): boolean {
  return resolveFrom.silent(projectDir, 'expo-dev-client/package.json') !== undefined;
}
