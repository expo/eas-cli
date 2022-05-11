import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import { readAppJson } from '../../build/utils/appJson';
import Log, { learnMore } from '../../log';
import { getProjectConfigDescription, getUsername } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';
import { resolveWorkflowAsync } from '../workflow';
import { GradleBuildContext } from './gradle';
import * as gradleUtils from './gradleUtils';

export const INVALID_APPLICATION_ID_MESSAGE = `Invalid format of Android applicationId. Only alphanumeric characters, '.' and '_' are allowed, and each '.' must be followed by a letter.`;

export async function ensureApplicationIdIsDefinedForManagedProjectAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<string> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
  assert(workflow === Workflow.MANAGED, 'This function should be called only for managed projects');

  try {
    return await getApplicationIdAsync(projectDir, exp, {
      moduleName: gradleUtils.DEFAULT_MODULE_NAME,
    });
  } catch {
    return await configureApplicationIdAsync(projectDir, exp);
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
  gradleContext?: GradleBuildContext
): Promise<string> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
  if (workflow === Workflow.GENERIC) {
    warnIfAndroidPackageDefinedInAppConfigForBareWorkflowProject(projectDir, exp);

    return getApplicationIdFromBareAsync(projectDir, gradleContext);
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

async function configureApplicationIdAsync(projectDir: string, exp: ExpoConfig): Promise<string> {
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

  const suggestedAndroidApplicationId = await getSuggestedApplicationIdAsync(exp);
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
      `Specifying "android.package" in ${getProjectConfigDescription(
        projectDir
      )} is deprecated for bare workflow projects.\n` +
        'EAS Build depends only on the value in the native code. Please remove the deprecated configuration.'
    );
    warnPrinted = true;
  }
}

async function getSuggestedApplicationIdAsync(exp: ExpoConfig): Promise<string | undefined> {
  // Attempt to use the ios bundle id first since it's convenient to have them aligned.
  const maybeBundleId = IOSConfig.BundleIdentifier.getBundleIdentifier(exp);
  if (maybeBundleId && isApplicationIdValid(maybeBundleId)) {
    return maybeBundleId;
  } else {
    const username = getUsername(exp, await ensureLoggedInAsync());
    // It's common to use dashes in your node project name, strip them from the suggested package name.
    const possibleId = `com.${username}.${exp.slug}`.split('-').join('');
    if (isApplicationIdValid(possibleId)) {
      return possibleId;
    }
  }
  return undefined;
}
