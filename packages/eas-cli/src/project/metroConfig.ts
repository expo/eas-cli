import * as MetroConfig from '@expo/metro-config';
import { exit } from '@oclif/errors';
import chalk from 'chalk';

import { BuildContext } from '../build/context';
import { Platform } from '../build/types';
import Log, { learnMore } from '../log';
import { confirmAsync } from '../prompts';

export async function validateMetroConfigForManagedWorkflowAsync(ctx: BuildContext<Platform>) {
  if (!(await MetroConfig.existsAsync(ctx.projectDir))) {
    return;
  }

  const metroConfig = await MetroConfig.loadAsync(ctx.projectDir, { withoutDefaults: true });
  const hasHashAssetFilesPlugin = metroConfig.transformer?.assetPlugins?.find((plugin: string) =>
    plugin.match(/expo-asset\/tools\/hashAssetFiles/)
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
    Log.warn(`We recommend you to abort, fix the ${chalk.bold('metro.config.js')}, and try again.`);
    Log.warn(
      learnMore('https://docs.expo.io/guides/customizing-metro/', {
        learnMoreMessage: 'Learn more on customizing Metro',
      })
    );

    const shouldAbort = await confirmAsync({
      message: 'Would you like to abort?',
    });
    if (shouldAbort) {
      Log.log('Aborting...');
      exit();
    }
  }
}
