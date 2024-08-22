import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import { GradleBuildContext } from './gradle';
import * as gradleUtils from './gradleUtils';
import { readAppJson } from '../../build/utils/appJson';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import env from '../../env';
import Log, { learnMore } from '../../log';
import {
  getOwnerAccountForProjectIdAsync,
  getProjectConfigDescription,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { Client } from '../../vcs/vcs';
import { resolveWorkflowAsync } from '../workflow';

export const INVALID_APPLICATION_ID_MESSAGE = `Invalid format of Android applicationId. Only alphanumeric characters, '.' and '_' are allowed, and each '.' must be followed by a letter.`;

export async function ensureApplicationIdIsDefinedForManagedProjectAsync({
  graphqlClient,
  projectDir,
  projectId,
  exp,
  vcsClient,
  nonInteractive,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  vcsClient: Client;
  nonInteractive: boolean;
}): Promise<string> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient);
  assert(workflow === Workflow.MANAGED, 'This function should be called only for managed projects');

  try {
    return await getApplicationIdAsync(projectDir, exp, vcsClient, {
      moduleName: gradleUtils.DEFAULT_MODULE_NAME,
    });
  } catch {
    return await configureApplicationIdAsync({
      graphqlClient,
      projectDir,
      projectId,
      exp,
      nonInteractive,
    });
  }
}

export class AmbiguousApplicationIdError extends Error {
  constructor(message?: string) {
    super(message ?? 'Could not resolve applicationId.');
  }
}

export async function getApplicationIdFromBareAsync(
  projectDir: string,
  gradleContext?: GradleBuildContext
): Promise<string> {
  if (env.overrideAndroidApplicationId) {
    return env.overrideAndroidApplicationId;
  }
  const errorMessage = 'Could not read applicationId from Android project.';

  if (gradleContext) {
    const buildGradle = await gradleUtils.getAppBuildGradleAsync(projectDir);
    const applicationIdSuffix = gradleUtils.resolveConfigValue(
      buildGradle,
      'applicationIdSuffix',
      gradleContext.flavor
    );
    if (applicationIdSuffix) {
      throw new Error('"applicationIdSuffix" in app/build.gradle is not supported.');
    }
    const applicationId = gradleUtils.resolveConfigValue(
      buildGradle,
      'applicationId',
      gradleContext.flavor
    );
    return nullthrows(applicationId, errorMessage);
  } else {
    // should return value only if productFlavors are not used
    const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
    const buildGradle = await fs.readFile(buildGradlePath, 'utf8');
    const matchResult = buildGradle.match(/applicationId ['"](.*)['"]/);
    if (buildGradle.match(/applicationIdSuffix/)) {
      throw new Error('"applicationIdSuffix" in app/build.gradle is not supported.');
    }
    if (buildGradle.match(/productFlavors/)) {
      throw new AmbiguousApplicationIdError(
        'Failed to autodetect applicationId in multi-flavor project.'
      );
    }
    return nullthrows(matchResult?.[1], errorMessage);
  }
}

export async function getApplicationIdAsync(
  projectDir: string,
  exp: ExpoConfig,
  vcsClient: Client,
  gradleContext?: GradleBuildContext
): Promise<string> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient);
  if (workflow === Workflow.GENERIC) {
    warnIfAndroidPackageDefinedInAppConfigForBareWorkflowProject(projectDir, exp);
    return await getApplicationIdFromBareAsync(projectDir, gradleContext);
  } else {
    const applicationId = AndroidConfig.Package.getPackage(exp);
    if (!applicationId || !isApplicationIdValid(applicationId)) {
      if (applicationId) {
        Log.warn(INVALID_APPLICATION_ID_MESSAGE);
      }
      throw new Error(
        `Specify "android.package" in ${getProjectConfigDescription(
          projectDir
        )} and run this command again.`
      );
    } else {
      return applicationId;
    }
  }
}

async function configureApplicationIdAsync({
  graphqlClient,
  projectDir,
  projectId,
  exp,
  nonInteractive,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  nonInteractive: boolean;
}): Promise<string> {
  if (nonInteractive) {
    throw new Error(
      `The "android.package" is required to be set in app config when running in non-interactive mode. ${learnMore(
        'https://docs.expo.dev/versions/latest/config/app/#package'
      )}`
    );
  }

  const paths = getConfigFilePaths(projectDir);
  // we can't automatically update app.config.js
  if (paths.dynamicConfigPath) {
    throw new Error(
      `"android.package" is not defined in your app.config.js and we can't update this file programmatically. Add the value on your own and run this command again.`
    );
  }

  assert(paths.staticConfigPath, 'app.json must exist');

  Log.addNewLineIfNone();
  Log.log(
    `${chalk.bold(`📝  Android application id`)} ${chalk.dim(
      learnMore('https://expo.fyi/android-package')
    )}`
  );

  const suggestedAndroidApplicationId = await getSuggestedApplicationIdAsync(
    graphqlClient,
    exp,
    projectId
  );
  const { packageName } = await promptAsync({
    name: 'packageName',
    type: 'text',
    message: `What would you like your Android application id to be?`,
    initial: suggestedAndroidApplicationId,
    validate: value => (isApplicationIdValid(value) ? true : INVALID_APPLICATION_ID_MESSAGE),
  });

  const rawStaticConfig = readAppJson(paths.staticConfigPath);
  rawStaticConfig.expo = {
    ...rawStaticConfig.expo,
    android: { ...rawStaticConfig.expo?.android, package: packageName },
  };
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  exp.android = { ...exp.android, package: packageName };

  return packageName;
}

export function isApplicationIdValid(applicationId: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(applicationId);
}

let warnPrinted = false;
export function warnIfAndroidPackageDefinedInAppConfigForBareWorkflowProject(
  projectDir: string,
  exp: ExpoConfig
): void {
  if (AndroidConfig.Package.getPackage(exp) && !warnPrinted) {
    Log.warn(
      `Specified value for "android.package" in ${getProjectConfigDescription(
        projectDir
      )} is ignored because an ${chalk.bold('android')} directory was detected in the project.\n` +
        'EAS Build will use the value found in the native code.'
    );
    warnPrinted = true;
  }
}

async function getSuggestedApplicationIdAsync(
  graphqlClient: ExpoGraphqlClient,
  exp: ExpoConfig,
  projectId: string
): Promise<string | undefined> {
  // Attempt to use the ios bundle id first since it's convenient to have them aligned.
  const maybeBundleId = IOSConfig.BundleIdentifier.getBundleIdentifier(exp);
  if (maybeBundleId && isApplicationIdValid(maybeBundleId)) {
    return maybeBundleId;
  } else {
    // the only callsite is heavily interactive
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    // It's common to use dashes in your node project name, strip them from the suggested package name.
    const possibleId = `com.${account.name}.${exp.slug}`.split('-').join('');
    if (isApplicationIdValid(possibleId)) {
      return possibleId;
    }
  }
  return undefined;
}
