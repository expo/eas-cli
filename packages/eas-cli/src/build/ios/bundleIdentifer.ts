import { ExpoConfig, IOSConfig } from '@expo/config';
import chalk from 'chalk';
import once from 'lodash/once';

import log from '../../log';
import { promptAsync } from '../../prompts';

export const getBundleIdentifier = once(_getBundleIdentifier);

async function _getBundleIdentifier(
  projectDir: string,
  manifest: ExpoConfig,
  options?: { displayAutoconfigMessage?: boolean; configDescription?: string }
): Promise<string> {
  const configDescription = options?.configDescription ?? 'app.config.js/app.json';
  const displayAutoconfigMessage = options?.displayAutoconfigMessage ?? true;
  const bundleIdentifierFromPbxproj = IOSConfig.BundleIdenitifer.getBundleIdentifierFromPbxproj(
    projectDir
  );
  const bundleIdentifierFromConfig = IOSConfig.BundleIdenitifer.getBundleIdentifier(manifest);
  if (bundleIdentifierFromPbxproj !== null && bundleIdentifierFromConfig !== null) {
    if (bundleIdentifierFromPbxproj === bundleIdentifierFromConfig) {
      return bundleIdentifierFromPbxproj;
    } else {
      log.addNewLineIfNone();
      log.warn(
        `We detected that your Xcode project is configured with a different bundle identifier than the one defined in ${configDescription}.`
      );
      if (displayAutoconfigMessage) {
        log(`If you choose the one defined in ${configDescription} we'll automatically configure your Xcode project with it.
However, if you choose the one defined in the Xcode project you'll have to update ${configDescription} on your own.
Otherwise, you'll see this prompt again in the future.`);
      }
      log.newLine();
      const { bundleIdentifier } = await promptAsync({
        type: 'select',
        name: 'bundleIdentifier',
        message: 'Which bundle identifier should we use?',
        choices: [
          {
            title: `${chalk.bold(bundleIdentifierFromPbxproj)} - In Xcode project`,
            value: bundleIdentifierFromPbxproj,
          },
          {
            title: `${chalk.bold(bundleIdentifierFromConfig)} - In your ${configDescription}`,
            value: bundleIdentifierFromConfig,
          },
        ],
      });
      return bundleIdentifier;
    }
  } else if (bundleIdentifierFromPbxproj === null && bundleIdentifierFromConfig === null) {
    throw new Error(`Please define "ios.bundleIdentifier" in your ${configDescription}`);
  } else {
    if (bundleIdentifierFromPbxproj !== null) {
      log(
        `Using ${chalk.bold(
          bundleIdentifierFromPbxproj
        )} as the bundle identifier (read from the Xcode project).`
      );
      return bundleIdentifierFromPbxproj;
    } else {
      // bundleIdentifierFromConfig is never null in this case
      // the following line is to satisfy TS
      const bundleIdentifier = bundleIdentifierFromConfig ?? '';
      log(
        `Using ${chalk.bold(
          bundleIdentifier
        )} as the bundle identifier (read from ${configDescription}).
We'll automatically configure your Xcode project using this value.`
      );
      return bundleIdentifier;
    }
  }
}
