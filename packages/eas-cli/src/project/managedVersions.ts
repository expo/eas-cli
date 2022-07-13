import { ExpoConfig } from '@expo/config';
import { AppVersionPolicy, EasJsonReader } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';

import Log from '../log';
import { confirmAsync } from '../prompts';

export async function ensureRemoteAppVersionPolicyAsync(
  projectDir: string,
  easJsonReader: EasJsonReader
): Promise<void> {
  const easJsonCliConfig = await easJsonReader.getCliConfigAsync();
  if (easJsonCliConfig?.appVersionPolicy === AppVersionPolicy.REMOTE) {
    return;
  }

  const confirm = await confirmAsync({
    message: 'Do you want to enable remote appVersionPolicy in your eas.json? ',
  });
  if (!confirm) {
    Log.log(
      `To enable remote version policy add ${chalk.bold(
        '{"cli": { "appVersionPolicy": "remote" }}'
      )} in eas.json`
    );
    throw new Error('Aborting ...');
  }

  const easJsonPath = EasJsonReader.formatEasJsonPath(projectDir);
  const easJson = await fs.readJSON(easJsonPath);
  easJson.cli = { ...easJson?.cli, appVersionPolicy: 'remote' };
  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  Log.withTick('Updated eas.json');
}

export async function validateAppConfigForManagedVersionsAsync(exp: ExpoConfig): Promise<void> {
  if (typeof exp.runtimeVersion === 'object' && exp.runtimeVersion?.policy === 'nativeVersion') {
    throw new Error(
      `${chalk.bold('nativeVersion')} policy for ${chalk.bold(
        'runtimeVersion'
      )} is not supported when managed versions are enabled. Switch policy e.g. to ${chalk.bold(
        'appVersion'
      )} or define version explicitly`
    );
  }
  if (exp.ios?.buildNumber !== undefined) {
    throw new Error(
      `${chalk.bold(
        'ios.buildNumber'
      )} field in app config is not supported when managed versions are enabled, remove it and rerun the command.`
    );
  }
  if (exp.android?.versionCode !== undefined) {
    throw new Error(
      `${chalk.bold(
        'android.versionCode'
      )} field in app config is not supported when managed versions are enabled, remove it and rerun the command.`
    );
  }
}
