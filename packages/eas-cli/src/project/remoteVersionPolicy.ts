import { ExpoConfig } from '@expo/config';
import { AppVersionPolicy, EasJsonReader } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';

import Log from '../log';
import { confirmAsync } from '../prompts';

export async function ensureRemoteVersionPolicyAsync(
  projectDir: string,
  easJsonReader: EasJsonReader
): Promise<void> {
  const easJsonCliConfig = await easJsonReader.getCliConfigAsync();
  if (easJsonCliConfig?.appVersionPolicy === AppVersionPolicy.REMOTE) {
    return;
  }

  Log.log(
    `Version policy defines whether version of your app should be based on your local project or values stored on EAS servers (remote). To use this command, you will need to enable remote version policy by adding ${chalk.bold(
      '{"cli": { "appVersionPolicy": "remote" }}'
    )} in eas.json.`
  );
  // TODO: add link to docs
  const confirm = await confirmAsync({
    message: 'Do you want us to enable it for you?',
  });
  if (!confirm) {
    throw new Error('Aborting...');
  }

  const easJsonPath = EasJsonReader.formatEasJsonPath(projectDir);
  const easJson = await fs.readJSON(easJsonPath);
  easJson.cli = { ...easJson?.cli, appVersionPolicy: AppVersionPolicy.REMOTE };
  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  Log.withTick('Updated eas.json');
}

export async function validateAppConfigForRemoteVersionPolicyAsync(exp: ExpoConfig): Promise<void> {
  if (typeof exp.runtimeVersion === 'object' && exp.runtimeVersion?.policy === 'nativeVersion') {
    throw new Error(
      `${chalk.bold('nativeVersion')} policy for ${chalk.bold(
        'runtimeVersion'
      )} is currently not supported when remote version policy is enabled. Switch policy e.g. to ${chalk.bold(
        'appVersion'
      )} or define version explicitly.`
    );
  }
  if (exp.ios?.buildNumber !== undefined) {
    throw new Error(
      `${chalk.bold(
        'ios.buildNumber'
      )} field in app config is not supported when remote version policy enabled, remove it and re-run the command.`
    );
  }
  if (exp.android?.versionCode !== undefined) {
    throw new Error(
      `${chalk.bold(
        'android.versionCode'
      )} field in app config is not supported when remote version policy is enabled, remove it and re-run the command.`
    );
  }
}
