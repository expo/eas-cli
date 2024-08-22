import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { AppVersionSource, EasJson, EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { Errors } from '@oclif/core';
import chalk from 'chalk';

import { BuildFlags } from '../build/types';
import Log, { learnMore } from '../log';
import { confirmAsync, selectAsync } from '../prompts';
import { ProfileData } from '../utils/profiles';

export enum AppVersionSourceUpdateOption {
  SET_TO_REMOTE,
  SET_TO_LOCAL,
  ABORT,
}

export async function ensureVersionSourceIsRemoteAsync(
  easJsonAccessor: EasJsonAccessor,
  { nonInteractive }: { nonInteractive: boolean }
): Promise<void> {
  let easJsonCliConfig = await EasJsonUtils.getCliConfigAsync(easJsonAccessor);
  if (easJsonCliConfig?.appVersionSource === undefined) {
    easJsonCliConfig = await ensureAppVersionSourceIsSetAsync(
      easJsonAccessor,
      easJsonCliConfig ?? undefined,
      nonInteractive
    );
  }
  if (easJsonCliConfig?.appVersionSource === AppVersionSource.REMOTE) {
    return;
  }
  if (nonInteractive) {
    throw new Error(
      `This project is not configured for using remote version source. Add ${chalk.bold(
        '{"cli": { "appVersionSource": "remote" }}'
      )} in eas.json or re-run this command without "--non-interactive" flag.`
    );
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

  await easJsonAccessor.readRawJsonAsync();
  easJsonAccessor.patch(easJsonRawObject => {
    easJsonRawObject.cli = { ...easJsonRawObject?.cli, appVersionSource: AppVersionSource.REMOTE };
    return easJsonRawObject;
  });
  await easJsonAccessor.writeAsync();
  Log.withTick('Updated eas.json');
}

export async function validateBuildProfileVersionSettingsAsync(
  profileInfo: ProfileData<'build'>,
  cliConfig: EasJson['cli'],
  projectDir: string,
  flags: BuildFlags
): Promise<void> {
  if (
    cliConfig?.appVersionSource === undefined &&
    profileInfo.profile.autoIncrement !== 'version'
  ) {
    if (profileInfo.profile.autoIncrement !== true) {
      Log.warn(`The field "cli.appVersionSource" is not set, but it will be required in the future. ${learnMore('https://docs.expo.dev/build-reference/app-versions/')}`);
    } else {
      const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
      cliConfig = await ensureAppVersionSourceIsSetAsync(
        easJsonAccessor,
        cliConfig,
        flags.nonInteractive
      );
    }
  }
  if (cliConfig?.appVersionSource !== AppVersionSource.REMOTE) {
    return;
  }
  if (profileInfo.profile.autoIncrement === 'version') {
    throw new Error(
      `${chalk.bold(
        '{"autoIncrement": "version"}'
      )} is not supported when app version source is set to remote.`
    );
  }
}

export function validateAppConfigForRemoteVersionSource(exp: ExpoConfig, platform: Platform): void {
  if (typeof exp.runtimeVersion === 'object' && exp.runtimeVersion?.policy === 'nativeVersion') {
    throw new Error(
      `${chalk.bold('nativeVersion')} policy for ${chalk.bold(
        'runtimeVersion'
      )} is currently not supported when version source is set to remote. Switch policy e.g. to ${chalk.bold(
        'appVersion'
      )} or define version explicitly.`
    );
  }
  if (platform === Platform.IOS && exp.ios?.buildNumber !== undefined) {
    Log.warn(
      `${chalk.bold(
        'ios.buildNumber'
      )} field in app config is ignored when version source is set to remote, but this value will still be in the manifest available via ${chalk.bold(
        'expo-constants'
      )}. It's recommended to remove this value from app config.`
    );
  }
  if (platform === Platform.ANDROID && exp.android?.versionCode !== undefined) {
    Log.warn(
      `${chalk.bold(
        'android.versionCode'
      )} field in app config is ignored when version source is set to remote, but this value will still be in the manifest available via ${chalk.bold(
        'expo-constants'
      )}. It's recommended to remove this value from app config.`
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

export async function ensureAppVersionSourceIsSetAsync(
  easJsonAccessor: EasJsonAccessor,
  easJsonCliConfig: EasJson['cli'] | undefined,
  nonInteractive: boolean
): Promise<EasJson['cli'] | undefined> {
  let selectOption;
  if (nonInteractive) {
    Log.warn(
      '"appVersionSource" is not specified. The previous default value for "appVersionSource" used to be "local", but it has been changed to "remote".'
    );
    Log.warn(
      'Cannot prompt to select the value of "appVersionSource" in non-interactive mode. Setting it to "local" to keep the backwards compatibility. If you wish to use the "remote" "appVersionSource", update the "eas.json" manually.'
    );
    Log.warn(
      learnMore('https://docs.expo.dev/build-reference/app-versions/', {
        learnMoreMessage: 'See the docs to learn more.',
        dim: false,
      })
    );
    selectOption = AppVersionSourceUpdateOption.SET_TO_LOCAL;
    process.env.EAS_BUILD_AUTOCOMMIT = '1'; // the user can't commit changes to eas.json in non-interactive mode
  } else {
    Log.log(
      `Please select your app version source. With "local", the build android.versionCode / ios.buildNumber are taken from app.json / app.config.js files and need to be incremented manually or automatically by setting autoIncrement: true in eas.json. With "remote", this value is handled remotely by EAS and can also be incremented automatically with each build by setting autoIncrement: true in eas.json. Until now, this project has been using the "local" version source (which was previously the default when the app version source was not specified). App version source can be set for you automatically, or you can configure it yourself - if you wish to use the default "remote" version source add ${chalk.bold(
        '{"cli": { "appVersionSource": "remote" }}'
      )} to your eas.json or if you want to use the "local" version source add ${chalk.bold(
        '{"cli": { "appVersionSource": "local" }}'
      )} to your eas.json.`
    );

    selectOption = await selectAsync(`What would you like to do?`, [
      {
        title: 'Update eas.json to use the default "remote" version source',
        value: AppVersionSourceUpdateOption.SET_TO_REMOTE,
      },
      {
        title: 'Update eas.json to use "local" version source',
        value: AppVersionSourceUpdateOption.SET_TO_LOCAL,
      },
      {
        title: "Don't update eas.json, abort command and configure manually",
        value: AppVersionSourceUpdateOption.ABORT,
      },
    ]);
  }

  if (selectOption === AppVersionSourceUpdateOption.SET_TO_LOCAL) {
    await easJsonAccessor.readRawJsonAsync();
    easJsonAccessor.patch(easJsonRawObject => {
      easJsonRawObject.cli = { ...easJsonRawObject?.cli, appVersionSource: AppVersionSource.LOCAL };
      return easJsonRawObject;
    });
    await easJsonAccessor.writeAsync();
    if (easJsonCliConfig) {
      easJsonCliConfig.appVersionSource = AppVersionSource.LOCAL;
    }
    Log.withTick('Updated eas.json');
  } else if (selectOption === AppVersionSourceUpdateOption.SET_TO_REMOTE) {
    await easJsonAccessor.readRawJsonAsync();
    easJsonAccessor.patch(easJsonRawObject => {
      easJsonRawObject.cli = {
        ...easJsonRawObject?.cli,
        appVersionSource: AppVersionSource.REMOTE,
      };
      return easJsonRawObject;
    });
    await easJsonAccessor.writeAsync();
    if (easJsonCliConfig) {
      easJsonCliConfig.appVersionSource = AppVersionSource.REMOTE;
    }
    Log.withTick('Updated eas.json');
  } else {
    Log.warn(`You'll need to configure ${chalk.bold('appVersionSource')} manually. ${learnMore('https://docs.expo.dev/build-reference/app-versions/')}`);
    Errors.error('Aborted.', { exit: 1 });
  }

  return easJsonCliConfig;
}
