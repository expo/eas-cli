import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';

import log from '../../log';
import { getProjectConfigDescription } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

enum BundleIdenitiferSource {
  XcodeProject,
  AppJson,
}

export async function configureBundleIdentifierAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  const configDescription = getProjectConfigDescription(projectDir);
  const bundleIdentifierFromPbxproj = IOSConfig.BundleIdenitifer.getBundleIdentifierFromPbxproj(
    projectDir
  );
  const bundleIdentifierFromConfig = IOSConfig.BundleIdenitifer.getBundleIdentifier(exp);
  if (bundleIdentifierFromPbxproj && bundleIdentifierFromConfig) {
    if (bundleIdentifierFromPbxproj !== bundleIdentifierFromConfig) {
      log.addNewLineIfNone();
      log.warn(
        `We detected that your Xcode project is configured with a different bundle identifier than the one defined in ${configDescription}.`
      );
      if (!(await hasApplicationIdInStaticConfigAsync(projectDir, exp))) {
        log(`If you choose the one defined in ${configDescription} we'll automatically configure your Xcode project with it.
However, if you choose the one defined in the Xcode project you'll have to update ${configDescription} on your own.
Otherwise, you'll see this prompt again in the future.`);
      }
      log.newLine();
      const { bundleIdentifierSource } = await promptAsync({
        type: 'select',
        name: 'bundleIdentifierSource',
        message: 'Which bundle identifier should we use?',
        choices: [
          {
            title: `${chalk.bold(bundleIdentifierFromPbxproj)} - In Xcode project`,
            value: BundleIdenitiferSource.XcodeProject,
          },
          {
            title: `${chalk.bold(bundleIdentifierFromConfig)} - In your ${configDescription}`,
            value: BundleIdenitiferSource.AppJson,
          },
        ],
      });
      switch (bundleIdentifierSource) {
        case BundleIdenitiferSource.AppJson: {
          IOSConfig.BundleIdenitifer.setBundleIdentifierForPbxproj(
            projectDir,
            bundleIdentifierFromConfig
          );
          break;
        }
        case BundleIdenitiferSource.XcodeProject: {
          await updateAppJsonConfigAsync(projectDir, exp, bundleIdentifierFromPbxproj);
          break;
        }
      }
    }
  } else if (!bundleIdentifierFromPbxproj && !bundleIdentifierFromConfig) {
    throw new Error(
      `Please define "ios.bundleIdentifier" in your ${configDescription} and run "eas build:configure" again.`
    );
  } else if (bundleIdentifierFromPbxproj && !bundleIdentifierFromConfig) {
    if (getConfigFilePaths(projectDir).staticConfigPath) {
      await updateAppJsonConfigAsync(projectDir, exp, bundleIdentifierFromPbxproj);
    } else {
      throw new Error(
        `Please define "ios.bundleIdentifier" in ${configDescription} and run "eas build:configure" again.`
      );
    }
  } else if (!bundleIdentifierFromPbxproj && bundleIdentifierFromConfig) {
    IOSConfig.BundleIdenitifer.setBundleIdentifierForPbxproj(
      projectDir,
      bundleIdentifierFromConfig
    );
  }
}

async function updateAppJsonConfigAsync(
  projectDir: string,
  exp: ExpoConfig,
  newBundleIdentifier: string
): Promise<void> {
  const paths = getConfigFilePaths(projectDir);
  assert(paths.staticConfigPath, "can't update dynamic configs");

  const rawStaticConfig = await fs.readJSON(paths.staticConfigPath);
  rawStaticConfig.expo = {
    ...rawStaticConfig.expo,
    ios: { ...rawStaticConfig.expo.ios, bundleIdentifier: newBundleIdentifier },
  };
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  exp.ios = { ...exp.ios, bundleIdentifier: newBundleIdentifier };
}

/**
 * Check if static config exists and if ios.bundleIdentifier is defined there.
 * It will return false if value in static config is different than exp.ios.bundleIdentifier
 */
async function hasApplicationIdInStaticConfigAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<boolean> {
  if (!exp.ios?.bundleIdentifier) {
    return false;
  }
  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath) {
    return false;
  }
  const rawStaticConfig = await fs.readJson(paths.staticConfigPath);
  return rawStaticConfig?.expo?.ios?.bundleIdentifier === exp.ios.bundleIdentifier;
}
