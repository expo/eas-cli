import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import Log from '../../log';
import { getProjectConfigDescription } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import {
  assertBundleIdentifierValid,
  getOrPromptForBundleIdentifierAsync,
  setBundleIdentifierInExpoConfigAsync,
} from '../../utils/promptConfigModifications';

enum BundleIdentiferSource {
  XcodeProject,
  AppJson,
}

export async function configureBundleIdentifierAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<string> {
  const bundleId = await _configureBundleIdentifierAsync(projectDir, exp);
  assertBundleIdentifierValid(bundleId);
  // TODO: Maybe check the git status here, skipping for now because it'll show too often.
  return bundleId;
}

export async function _configureBundleIdentifierAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<string> {
  const bundleIdentifierFromPbxproj = IOSConfig.BundleIdentifier.getBundleIdentifierFromPbxproj(
    projectDir
  );
  const bundleIdentifierFromConfig = IOSConfig.BundleIdentifier.getBundleIdentifier(exp);
  if (bundleIdentifierFromPbxproj && bundleIdentifierFromConfig) {
    const configDescription = getProjectConfigDescription(projectDir);
    if (bundleIdentifierFromPbxproj !== bundleIdentifierFromConfig) {
      Log.addNewLineIfNone();
      Log.warn(
        `We detected that your Xcode project is configured with a different bundle identifier than the one defined in ${configDescription}.`
      );
      const hasBundleIdentifierInStaticConfig = await hasBundleIdentifierInStaticConfigAsync(
        projectDir,
        exp
      );
      if (!hasBundleIdentifierInStaticConfig) {
        Log.log(`If you choose the one defined in ${configDescription} we'll automatically configure your Xcode project with it.
However, if you choose the one defined in the Xcode project you'll have to update ${configDescription} on your own.`);
      }
      Log.newLine();
      const { bundleIdentifierSource } = await promptAsync({
        type: 'select',
        name: 'bundleIdentifierSource',
        message: 'Which bundle identifier should we use?',
        choices: [
          {
            title: `${chalk.bold(bundleIdentifierFromPbxproj)} - In Xcode project`,
            value: BundleIdentiferSource.XcodeProject,
          },
          {
            title: `${chalk.bold(bundleIdentifierFromConfig)} - In your ${configDescription}`,
            value: BundleIdentiferSource.AppJson,
          },
        ],
      });
      switch (bundleIdentifierSource) {
        case BundleIdentiferSource.AppJson: {
          IOSConfig.BundleIdentifier.setBundleIdentifierForPbxproj(
            projectDir,
            bundleIdentifierFromConfig
          );
          return bundleIdentifierFromConfig;
        }
        case BundleIdentiferSource.XcodeProject: {
          const bundleIdentifier = await setBundleIdentifierInExpoConfigAsync(
            projectDir,
            bundleIdentifierFromPbxproj,
            exp
          );
          if (!exp.ios) exp.ios = {};
          exp.ios.bundleIdentifier = bundleIdentifier;
          return bundleIdentifier;
        }
      }
    }
  }
  let bundleIdentifier: string;
  if (bundleIdentifierFromConfig) {
    bundleIdentifier = bundleIdentifierFromConfig;
    IOSConfig.BundleIdentifier.setBundleIdentifierForPbxproj(
      projectDir,
      bundleIdentifierFromConfig
    );
  } else if (bundleIdentifierFromPbxproj) {
    bundleIdentifier = await setBundleIdentifierInExpoConfigAsync(
      projectDir,
      bundleIdentifierFromPbxproj,
      exp
    );
  } else {
    bundleIdentifier = await getOrPromptForBundleIdentifierAsync(projectDir);
    // Only update if the native folder exists, this allows support for prompting in managed.
    if (fs.existsSync(path.join(projectDir, 'ios'))) {
      IOSConfig.BundleIdentifier.setBundleIdentifierForPbxproj(projectDir, bundleIdentifier);
    }
  }
  // sync up the config
  if (!exp.ios) exp.ios = {};
  exp.ios.bundleIdentifier = bundleIdentifier;

  return bundleIdentifier;
}

/**
 * Check if static config exists and if ios.bundleIdentifier is defined there.
 * It will return false if the value in static config is different than "ios.bundleIdentifier" in ExpoConfig
 */
async function hasBundleIdentifierInStaticConfigAsync(
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
