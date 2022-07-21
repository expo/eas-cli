import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { AppVersionSource, EasJsonReader } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';

import Log from '../log';
import { confirmAsync } from '../prompts';

export async function ensureRemoteVersionPolicyAsync(
  projectDir: string,
  easJsonReader: EasJsonReader
): Promise<void> {
  const easJsonCliConfig = await easJsonReader.getCliConfigAsync();
  if (easJsonCliConfig?.appVersionSource === AppVersionSource.REMOTE) {
    return;
  }

  Log.log(
    `The app version source defines whether the app version is stored locally in your project source (e.g. in app.json, Info.plist, or build.gradle) or remotely on EAS servers and only applied to the project at build time. To use this command, you will need to enable the remote version policy by adding  ${chalk.bold(
      '{"cli": { "appVersionSource": "remote" }}'
    )} in eas.json.`
  );
  // TODO: add link to docs
  const confirm = await confirmAsync({
    message: 'Do you want to set app version source to remote now?',
  });
  if (!confirm) {
    throw new Error('Aborting...');
  }

  const easJsonPath = EasJsonReader.formatEasJsonPath(projectDir);
  const easJson = await fs.readJSON(easJsonPath);
  easJson.cli = { ...easJson?.cli, appVersionSource: AppVersionSource.REMOTE };
  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  Log.withTick('Updated eas.json');
}

export async function validateAppConfigForRemoteVersionPolicyAsync(exp: ExpoConfig): Promise<void> {
  if (typeof exp.runtimeVersion === 'object' && exp.runtimeVersion?.policy === 'nativeVersion') {
    throw new Error(
      `${chalk.bold('nativeVersion')} policy for ${chalk.bold(
        'runtimeVersion'
      )} is currently not supported when version source is set to remote. Switch policy e.g. to ${chalk.bold(
        'appVersion'
      )} or define version explicitly.`
    );
  }
  if (exp.ios?.buildNumber !== undefined) {
    throw new Error(
      `${chalk.bold(
        'ios.buildNumber'
      )} field in app config is not supported when version source is set to remote, remove it and re-run the command.`
    );
  }
  if (exp.android?.versionCode !== undefined) {
    throw new Error(
      `${chalk.bold(
        'android.versionCode'
      )} field in app config is not supported when version source is set to remote, remove it and re-run the command.`
    );
  }
}

export function getBuildVersionName(platform: Platform): string {
  if (platform === Platform.ANDROID) {
    return 'versionCode';
  } else {
    return 'buildNumber';
  }
}
