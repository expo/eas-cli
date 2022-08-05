import { Platform } from '@expo/eas-build-job';
import { Errors } from '@oclif/core';
import chalk from 'chalk';
import type MetroConfig from 'metro-config';
import resolveFrom from 'resolve-from';

import { BuildContext } from '../build/context';
import Log, { learnMore } from '../log';
import { confirmAsync } from '../prompts';

export async function validateMetroConfigForManagedWorkflowAsync(
  ctx: BuildContext<Platform>
): Promise<void> {
  if (!(await configExistsAsync(ctx.projectDir))) {
    return;
  }

  const metroConfig = await loadConfigAsync(ctx.projectDir);
  const hasHashAssetFilesPlugin = metroConfig.transformer?.assetPlugins?.find((plugin: string) =>
    plugin.match(/expo-asset[/|\\]tools[/|\\]hashAssetFiles/)
  );
  if (!hasHashAssetFilesPlugin) {
    Log.warn(
      `It looks like that you are using a custom ${chalk.bold(
        'metro.config.js'
      )} that does not extend ${chalk.bold('@expo/metro-config')}.`
    );
    Log.warn(
      'This can result in unexpected and hard to debug issues, like missing assets in the production bundle.'
    );
    if (!ctx.nonInteractive) {
      Log.warn(
        `We recommend you to abort, fix the ${chalk.bold('metro.config.js')}, and try again.`
      );
    }
    Log.warn(
      learnMore('https://docs.expo.dev/guides/customizing-metro/', {
        learnMoreMessage: 'Learn more on customizing Metro',
      })
    );

    if (ctx.nonInteractive) {
      Log.warn("You've run EAS CLI in non-interactive mode, proceeding...");
      return;
    }

    const shouldAbort = await confirmAsync({
      message: 'Would you like to abort?',
    });
    if (shouldAbort) {
      Log.error('Aborting...');
      Errors.exit(1);
    }
  }
}

function importMetroConfigFromProject(projectDir: string): typeof MetroConfig {
  const resolvedPath = resolveFrom.silent(projectDir, 'metro-config');
  if (!resolvedPath) {
    throw new MetroConfigPackageMissingError(
      'Missing package "metro-config" in the project. ' +
        'This usually means `react-native` is not installed. ' +
        'Verify that dependencies in package.json include "react-native" ' +
        'and run `yarn` or `npm install`.'
    );
  }
  return require(resolvedPath);
}

async function configExistsAsync(projectRoot: string): Promise<boolean> {
  try {
    const MetroConfig = importMetroConfigFromProject(projectRoot);
    const result = await MetroConfig.resolveConfig(undefined, projectRoot);
    return !result.isEmpty;
  } catch (err) {
    if (err instanceof MetroConfigPackageMissingError) {
      return false;
    } else {
      throw err;
    }
  }
}

async function loadConfigAsync(projectDir: string): Promise<MetroConfig.ConfigT> {
  const MetroConfig = importMetroConfigFromProject(projectDir);
  return await MetroConfig.loadConfig({ cwd: projectDir }, {});
}

class MetroConfigPackageMissingError extends Error {}
