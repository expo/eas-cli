import { Platform, Workflow } from '@expo/eas-build-job';
import { EasJson, EasJsonAccessor } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';

import Log, { learnMore } from '../log';
import { resolveWorkflowAsync } from '../project/workflow';
import { easCliVersion } from '../utils/easCli';
import { Client } from '../vcs/vcs';
import { maybeBailOnRepoStatusAsync, reviewAndCommitChangesAsync } from './utils/repository';

interface ConfigureParams {
  projectDir: string;
  nonInteractive: boolean;
  vcsClient: Client;
}

export async function easJsonExistsAsync(projectDir: string): Promise<boolean> {
  return await fs.pathExists(EasJsonAccessor.formatEasJsonPath(projectDir));
}

/**
 * Creates eas.json if it does not exist.
 *
 * Returns:
 * - false - if eas.json already exists
 * - true - if eas.json was created by the function
 */
export async function ensureProjectConfiguredAsync(
  configureParams: ConfigureParams
): Promise<boolean> {
  if (await easJsonExistsAsync(configureParams.projectDir)) {
    return false;
  }

  await configureAsync(configureParams);
  return true;
}

async function configureAsync({
  projectDir,
  nonInteractive,
  vcsClient,
}: ConfigureParams): Promise<void> {
  await maybeBailOnRepoStatusAsync(vcsClient);

  await createEasJsonAsync(projectDir, vcsClient);

  if (await vcsClient.isCommitRequiredAsync()) {
    Log.newLine();
    await reviewAndCommitChangesAsync(vcsClient, 'Configure EAS Build', {
      nonInteractive,
    });
  }
}

const EAS_JSON_MANAGED_DEFAULT: EasJson = {
  cli: {
    version: `>= ${easCliVersion}`,
  },
  build: {
    development: {
      developmentClient: true,
      distribution: 'internal',
    },
    preview: {
      distribution: 'internal',
    },
    production: {},
  },
  submit: {
    production: {},
  },
};

const EAS_JSON_BARE_DEFAULT: EasJson = {
  cli: {
    version: `>= ${easCliVersion}`,
  },
  build: {
    development: {
      distribution: 'internal',
      android: {
        gradleCommand: ':app:assembleDebug',
      },
      ios: {
        buildConfiguration: 'Debug',
      },
    },
    preview: {
      distribution: 'internal',
    },
    production: {},
  },
  submit: {
    production: {},
  },
};

async function createEasJsonAsync(projectDir: string, vcsClient: Client): Promise<void> {
  const easJsonPath = EasJsonAccessor.formatEasJsonPath(projectDir);

  const hasAndroidNativeProject =
    (await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient)) === Workflow.GENERIC;
  const hasIosNativeProject =
    (await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient)) === Workflow.GENERIC;
  const easJson =
    hasAndroidNativeProject || hasIosNativeProject
      ? EAS_JSON_BARE_DEFAULT
      : EAS_JSON_MANAGED_DEFAULT;

  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  await vcsClient.trackFileAsync(easJsonPath);
  Log.withTick(
    `Generated ${chalk.bold('eas.json')}. ${learnMore(
      'https://docs.expo.dev/build-reference/eas-json/'
    )}`
  );
}
