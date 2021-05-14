import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import { Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import Log from '../../log';
import { getProjectConfigDescription } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

const INVALID_APPLICATION_ID_MESSAGE = `Invalid format of Android applicationId. Only alphanumeric characters, '.' and '_' are allowed, and each '.' must be followed by a letter.`;

export async function getOrConfigureApplicationIdAsync({
  projectDir,
  exp,
  workflow,
}: {
  projectDir: string;
  exp: ExpoConfig;
  workflow: Workflow;
}): Promise<string> {
  try {
    return getApplicationId({ projectDir, exp, workflow });
  } catch (err) {
    if (workflow === Workflow.MANAGED) {
      return await configureApplicationIdAsync(projectDir, exp);
    } else {
      throw err;
    }
  }
}

export function getApplicationId({
  projectDir,
  exp,
  workflow,
}: {
  projectDir: string;
  exp: ExpoConfig;
  workflow: Workflow;
}): string {
  if (workflow === Workflow.GENERIC) {
    warnIfAndroidPackageDefinedInAppConfigForGenericProject(projectDir, exp);

    const errorMessage = 'Could not read application id from Android project.';
    const buildGradlePath = AndroidConfig.Paths.getAppBuildGradle(projectDir);
    if (!fs.pathExistsSync(buildGradlePath)) {
      throw new Error(errorMessage);
    }
    const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
    const matchResult = buildGradle.match(/applicationId ['"](.*)['"]/);
    return nullthrows(matchResult?.[1], errorMessage);
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
  if (!paths.staticConfigPath) {
    throw new Error(
      `"android.package" is not defined in your app.config.js and we can't update this file programatically. Add the value on your own and run this command again.`
    );
  }

  const { packageName } = await promptAsync({
    name: 'packageName',
    type: 'text',
    message: `What would you like your Android package name to be?`,
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

export function warnIfAndroidPackageDefinedInAppConfigForGenericProject(
  projectDir: string,
  exp: ExpoConfig
): void {
  if (AndroidConfig.Package.getPackage(exp)) {
    Log.warn(
      `Specifying "android.package" in ${getProjectConfigDescription(
        projectDir
      )} is deprecated for generic projects.\n` +
        'EAS Build depends only on the value in the native code. Please remove the deprecated configuration.'
    );
  }
}
