import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import once from 'lodash/once';

import Log, { learnMore } from '../../log';
import { promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';
import { getProjectConfigDescription, getUsername, sanitizedProjectName } from '../projectUtils';
import { resolveWorkflow } from '../workflow';

const INVALID_BUNDLE_IDENTIFIER_MESSAGE = `Invalid format of iOS bundle identifier. Only alphanumeric characters, '.' and '-' are allowed, and each '.' must be followed by a letter.`;

export async function ensureBundleIdentifierIsDefinedForManagedProjectAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<string> {
  const workflow = resolveWorkflow(projectDir, Platform.IOS);
  assert(workflow === Workflow.MANAGED, 'This function should be called only for managed projects');

  try {
    return getBundleIdentifier(projectDir, exp);
  } catch (err) {
    return await configureBundleIdentifierAsync(projectDir, exp);
  }
}

export function getBundleIdentifier(
  projectDir: string,
  exp: ExpoConfig,
  { targetName, buildConfiguration }: { targetName?: string; buildConfiguration?: string } = {}
): string {
  const workflow = resolveWorkflow(projectDir, Platform.IOS);
  if (workflow === Workflow.GENERIC) {
    warnIfBundleIdentifierDefinedInAppConfigForGenericProject(projectDir, exp);

    const bundleIdentifier = IOSConfig.BundleIdentifier.getBundleIdentifierFromPbxproj(projectDir, {
      targetName,
      buildConfiguration,
    });
    const buildConfigurationDesc =
      targetName && buildConfiguration
        ? ` (target = ${targetName}, build configuration = ${buildConfiguration})`
        : '';
    assert(
      bundleIdentifier,
      `Could not read bundle identifier from Xcode project${buildConfigurationDesc}.`
    );
    if (!isBundleIdentifierValid(bundleIdentifier)) {
      throw new Error(
        `Bundle identifier "${bundleIdentifier}" is not valid${buildConfigurationDesc}. Open the project in Xcode to fix it.`
      );
    }
    return bundleIdentifier;
  } else {
    // TODO: the following asserts are only temporary until we support app extensions in managed projects
    assert(
      !targetName || targetName === sanitizedProjectName(exp.name),
      'targetName cannot be set to an arbitrary value for managed projects'
    );
    assert(!buildConfiguration, 'buildConfiguration cannot be passed for managed projects');
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

  Log.addNewLineIfNone();
  Log.log(
    `${chalk.bold(`📝  iOS Bundle Identifier`)} ${chalk.dim(
      learnMore('https://expo.fyi/bundle-identifier')
    )}`
  );

  const suggestedBundleIdentifier = await getSuggestedBundleIdentifierAsync(exp);
  const { bundleIdentifier } = await promptAsync({
    name: 'bundleIdentifier',
    type: 'text',
    message: `What would you like your iOS bundle identifier to be?`,
    initial: suggestedBundleIdentifier,
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
  return /^[a-zA-Z0-9-.]+$/.test(bundleIdentifier);
}

function _warnIfBundleIdentifierDefinedInAppConfigForGenericProject(
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

export const warnIfBundleIdentifierDefinedInAppConfigForGenericProject = once(
  _warnIfBundleIdentifierDefinedInAppConfigForGenericProject
);

export function isWildcardBundleIdentifier(bundleIdentifier: string): boolean {
  const wildcardRegex = /^[A-Za-z0-9.-]+\*$/;
  return wildcardRegex.test(bundleIdentifier);
}

async function getSuggestedBundleIdentifierAsync(exp: ExpoConfig): Promise<string | undefined> {
  // Attempt to use the android package name first since it's convenient to have them aligned.
  const maybeAndroidPackage = AndroidConfig.Package.getPackage(exp);
  if (maybeAndroidPackage && isBundleIdentifierValid(maybeAndroidPackage)) {
    return maybeAndroidPackage;
  } else {
    const username = getUsername(exp, await ensureLoggedInAsync());
    // It's common to use dashes in your node project name, strip them from the suggested package name.
    const possibleId = `com.${username}.${exp.slug}`.split('-').join('');
    if (isBundleIdentifierValid(possibleId)) {
      return possibleId;
    }
  }
  return undefined;
}
