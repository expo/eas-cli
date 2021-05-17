import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import assert from 'assert';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import { getProjectConfigDescription } from '../projectUtils';
import { resolveWorkflow } from '../workflow';

const INVALID_BUNDLE_IDENTIFIER_MESSAGE = `Invalid format of iOS bundle identifier. Only alphanumeric characters, '.' and '-' are allowed, and each '.' must be followed by a letter.`;

export async function getOrConfigureBundleIdentifierAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<string> {
  try {
    return getBundleIdentifier(projectDir, exp);
  } catch (err) {
    const workflow = resolveWorkflow(projectDir, Platform.IOS);
    if (workflow === Workflow.MANAGED) {
      return await configureBundleIdentifierAsync(projectDir, exp);
    } else {
      throw err;
    }
  }
}

export function getBundleIdentifier(projectDir: string, exp: ExpoConfig): string {
  const workflow = resolveWorkflow(projectDir, Platform.IOS);
  if (workflow === Workflow.GENERIC) {
    const bundleIdentifier = IOSConfig.BundleIdentifier.getBundleIdentifierFromPbxproj(projectDir);
    return nullthrows(bundleIdentifier, 'Could not read bundle identifier from Xcode project.');
  } else {
    const bundleIdentifer = IOSConfig.BundleIdentifier.getBundleIdentifier(exp);
    if (!bundleIdentifer || !isBundleIdentifierValid(bundleIdentifer)) {
      if (bundleIdentifer) {
        Log.warn(INVALID_BUNDLE_IDENTIFIER_MESSAGE);
      }
      throw new Error(
        `Specify "ios.bundleIdentifier" in ${getProjectConfigDescription(
          projectDir
        )} and run this command again.`
      );
    } else {
      return bundleIdentifer;
    }
  }
}

async function configureBundleIdentifierAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<string> {
  const paths = getConfigFilePaths(projectDir);
  // we can't automatically update app.config.js
  if (paths.dynamicConfigPath) {
    throw new Error(
      `"ios.bundleIdentifier" is not defined in your app.config.js and we can't update this file programatically. Add the value on your own and run this command again.`
    );
  }

  assert(paths.staticConfigPath, 'app.json must exist');

  const { bundleIdentifier } = await promptAsync({
    name: 'bundleIdentifier',
    type: 'text',
    message: `What would you like your iOS bundle identifier to be?`,
    validate: value => (isBundleIdentifierValid(value) ? true : INVALID_BUNDLE_IDENTIFIER_MESSAGE),
  });

  const rawStaticConfig = await fs.readJSON(paths.staticConfigPath);
  rawStaticConfig.expo = {
    ...rawStaticConfig.expo,
    ios: { ...rawStaticConfig.expo?.ios, bundleIdentifier },
  };
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  exp.ios = { ...exp.ios, bundleIdentifier };

  return bundleIdentifier;
}

function isBundleIdentifierValid(bundleIdentifier: string): boolean {
  return /^[a-zA-Z]+(\.[a-zA-Z0-9-]+)*$/.test(bundleIdentifier);
}

export function warnIfBundleIdentifierDefinedInAppConfigForGenericProject(
  projectDir: string,
  exp: ExpoConfig
): void {
  if (IOSConfig.BundleIdentifier.getBundleIdentifier(exp)) {
    Log.warn(
      `Specifying "ios.bundleIdentifier" in ${getProjectConfigDescription(
        projectDir
      )} is deprecated for generic projects.\n` +
        'EAS Build depends only on the value in the native code. Please remove the deprecated configuration.'
    );
  }
}
