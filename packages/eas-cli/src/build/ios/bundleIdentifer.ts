import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';

import log from '../../log';
import {
  ensureAppIdentifierIsDefinedAsync,
  getProjectConfigDescription,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { Platform } from '../types';

enum BundleIdentiferSource {
  XcodeProject,
  AppJson,
}

function isBundleIdentifierValid(bundleIdentifier: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9\-.]+$/.test(bundleIdentifier);
}

export async function ensureBundleIdentifierIsValidAsync(projectDir: string) {
  const bundleIdentifier = await ensureAppIdentifierIsDefinedAsync(projectDir, Platform.iOS);
  if (!isBundleIdentifierValid(bundleIdentifier)) {
    const configDescription = getProjectConfigDescription(projectDir);
    log.error(
      `Invalid format of iOS bundleId. Only alphanumeric characters, '.' and '-' are allowed, and each '.' must be followed by a letter.`
    );
    log.error(`Update "ios.bundleIdentifier" in ${configDescription} and run this command again.`);
    throw new Error('Invalid bundleIdentifier');
  }
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
      const hasBundleIdentifierInStaticConfig = await hasBundleIdentifierInStaticConfigAsync(
        projectDir,
        exp
      );
      if (!hasBundleIdentifierInStaticConfig) {
        log(`If you choose the one defined in ${configDescription} we'll automatically configure your Xcode project with it.
However, if you choose the one defined in the Xcode project you'll have to update ${configDescription} on your own.`);
      }
      log.newLine();
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
          IOSConfig.BundleIdenitifer.setBundleIdentifierForPbxproj(
            projectDir,
            bundleIdentifierFromConfig
          );
          break;
        }
        case BundleIdentiferSource.XcodeProject: {
          if (hasBundleIdentifierInStaticConfig) {
            await updateAppJsonConfigAsync(projectDir, exp, bundleIdentifierFromPbxproj);
          } else {
            throw new Error(missingBundleIdentifierMessage(configDescription));
          }
          break;
        }
      }
    }
  } else if (!bundleIdentifierFromPbxproj && !bundleIdentifierFromConfig) {
    throw new Error(missingBundleIdentifierMessage(configDescription));
  } else if (bundleIdentifierFromPbxproj && !bundleIdentifierFromConfig) {
    if (getConfigFilePaths(projectDir).staticConfigPath) {
      await updateAppJsonConfigAsync(projectDir, exp, bundleIdentifierFromPbxproj);
    } else {
      throw new Error(missingBundleIdentifierMessage(configDescription));
    }
  } else if (!bundleIdentifierFromPbxproj && bundleIdentifierFromConfig) {
    IOSConfig.BundleIdenitifer.setBundleIdentifierForPbxproj(
      projectDir,
      bundleIdentifierFromConfig
    );
  }
}

function missingBundleIdentifierMessage(configDescription: string): string {
  return `Please define "ios.bundleIdentifier" in ${configDescription} and run "eas build:configure" again.`;
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
    ios: { ...rawStaticConfig.expo?.ios, bundleIdentifier: newBundleIdentifier },
  };
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  exp.ios = { ...exp.ios, bundleIdentifier: newBundleIdentifier };
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
