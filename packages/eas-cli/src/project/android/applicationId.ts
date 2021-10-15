import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import Log, { learnMore } from '../../log';
import { getProjectConfigDescription, getUsername } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';
import { resolveWorkflowAsync } from '../workflow';
import { GradleBuildContext } from './gradle';
import * as gradleUtils from './gradleUtils';

const INVALID_APPLICATION_ID_MESSAGE = `Invalid format of Android applicationId. Only alphanumeric characters, '.' and '_' are allowed, and each '.' must be followed by a letter.`;

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
  } catch (err) {
    return await configureApplicationIdAsync(projectDir, exp);
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

    const errorMessage = 'Could not read application id from Android project.';
    if (gradleContext) {
      const buildGradle = await gradleUtils.getAppBuildGradleAsync(projectDir);
      const applicationId = gradleUtils.resolveConfigValue(
        buildGradle,
        'applicationId',
        gradleContext.flavor
      );
      return nullthrows(applicationId, errorMessage);
    } else {
      // fallback to best effort approach, this logic can be dropped when we start supporting
      // modules different than 'app' and 'flavorDimensions'
      let buildGradlePath = null;
      try {
        buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
      } catch {}
      if (!buildGradlePath || !(await fs.pathExists(buildGradlePath))) {
        throw new Error(errorMessage);
      }
      const buildGradle = await fs.readFile(buildGradlePath, 'utf8');
      const matchResult = buildGradle.match(/applicationId ['"](.*)['"]/);
      const applicationId = nullthrows(matchResult?.[1], errorMessage);

      Log.warn(`Unable to detect applicationId`);
      Log.warn(`Falling back to best effort approach, using applicationId ${applicationId}`);
      return applicationId;
    }
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
      `"android.package" is not defined in your app.config.js and we can't update this file programatically. Add the value on your own and run this command again.`
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

  const rawStaticConfig = await fs.readJSON(paths.staticConfigPath);
  rawStaticConfig.expo = {
    ...rawStaticConfig.expo,
    android: { ...rawStaticConfig.expo?.android, package: packageName },
  };
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  exp.android = { ...exp.android, package: packageName };

  return packageName;
}

function isApplicationIdValid(applicationId: string): boolean {
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
