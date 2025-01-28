import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { getInfoPlistPathFromPbxproj } from '@expo/config-plugins/build/ios/utils/getInfoPlistPath';
import { Platform, Workflow } from '@expo/eas-build-job';
import plist from '@expo/plist';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';

import { readAppJson } from '../../build/utils/appJson';
import Log, { learnMore } from '../../log';
import { promptAsync } from '../../prompts';
import { Client } from '../../vcs/vcs';
import { getProjectConfigDescription } from '../projectUtils';
import { resolveWorkflowAsync } from '../workflow';

/** Non-exempt encryption must be set on every build in App Store Connect, we move it to before the build process to attempt only setting it once for the entire life-cycle of the project. */
export async function ensureNonExemptEncryptionIsDefinedForManagedProjectAsync({
  projectDir,
  exp,
  vcsClient,
  nonInteractive,
}: {
  projectDir: string;
  exp: ExpoConfig;
  vcsClient: Client;
  nonInteractive: boolean;
}): Promise<void> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);
  assert(workflow === Workflow.MANAGED, 'This function should be called only for managed projects');

  try {
    await getNonExemptEncryptionAsync(projectDir, exp, vcsClient);
  } catch {
    await configureNonExemptEncryptionAsync({
      projectDir,
      exp,
      nonInteractive,
    });
  }
}

export class AmbiguousNonExemptEncryptionError extends Error {
  constructor(message?: string) {
    super(message ?? 'Could not resolve non-exempt encryption setting.');
  }
}

export async function getNonExemptEncryptionAsync(
  projectDir: string,
  exp: ExpoConfig,
  vcsClient: Client,
  xcodeContext?: { targetName?: string; buildConfiguration?: string }
): Promise<void> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);

  if (workflow === Workflow.GENERIC) {
    const xcodeProject = IOSConfig.XcodeUtils.getPbxproj(projectDir);

    const infoPlistBuildProperty = getInfoPlistPathFromPbxproj(xcodeProject);
    if (!infoPlistBuildProperty) {
      throw new Error('Info.plist file linked to Xcode project does not exist');
    }

    //: [root]/myapp/ios/MyApp/Info.plist
    const infoPlistPath = path.join(
      //: myapp/ios
      projectDir,
      'ios',
      //: MyApp/Info.plist
      infoPlistBuildProperty
    );
    if (!(await fs.promises.stat(infoPlistPath))) {
      throw new Error(`Info.plist file linked to Xcode project does not exist: ${infoPlistPath}`);
    }
    const infoPlist = plist.parse(await fs.promises.readFile(infoPlistPath, 'utf8'));

    const nonExemptEncryption = infoPlist['ITSAppUsesNonExemptEncryption'];
    const buildConfigurationDesc =
      xcodeContext?.targetName && xcodeContext?.buildConfiguration
        ? ` (target = ${xcodeContext.targetName}, build configuration = ${xcodeContext.buildConfiguration})`
        : '';
    assert(
      nonExemptEncryption !== undefined,
      `Could not read non-exempt encryption setting from Xcode project${buildConfigurationDesc}.`
    );
    return nonExemptEncryption;
  } else {
    const appUsesNonExemptEncryption = exp.ios?.infoPlist?.ITSAppUsesNonExemptEncryption;

    if (appUsesNonExemptEncryption == null) {
      throw new Error(
        `Specify "ios.infoPlist.ITSAppUsesNonExemptEncryption" in ${getProjectConfigDescription(
          projectDir
        )} and run this command again.`
      );
    }
    return appUsesNonExemptEncryption;
  }
}

async function configureNonExemptEncryptionAsync({
  projectDir,
  exp,
  nonInteractive,
}: {
  projectDir: string;
  exp: ExpoConfig;
  nonInteractive: boolean;
}): Promise<void> {
  if (nonInteractive) {
    Log.warn(
      `Set "ios.infoPlist.ITSAppUsesNonExemptEncryption" in the app config to release Apple builds faster. Setting to false and continuing.`
    );
  }

  const paths = getConfigFilePaths(projectDir);
  if (paths.dynamicConfigPath) {
    Log.warn(
      chalk`"ios.infoPlist.ITSAppUsesNonExemptEncryption" is not defined in your app.config.js and it cannot be updated programmatically. Add the value manually or select it in the App Store after every build. {dim Learn more: ${learnMore(
        'https://developer.apple.com/documentation/Security/complying-with-encryption-export-regulations'
      )}`
    );
    return;
  }

  assert(paths.staticConfigPath, 'app.json must exist');

  Log.addNewLineIfNone();
  Log.log(
    `${chalk.bold(`📝  Does your app use custom encryption?`)} ${chalk.dim(
      learnMore(
        'https://developer.apple.com/documentation/Security/complying-with-encryption-export-regulations'
      )
    )}`
  );

  const { onlyExemptEncryption } = await promptAsync({
    name: 'onlyExemptEncryption',
    type: 'confirm',
    message: `iOS app only uses standard/exempt encryption? Selecting 'No' will require annual self-classification reports for the US government.`,
    // message: `Does your app use non-exempt encryption?`,
    initial: true,
  });

  const rawStaticConfig = readAppJson(paths.staticConfigPath);

  const ITSAppUsesNonExemptEncryption = !onlyExemptEncryption;
  if (rawStaticConfig.expo) {
    rawStaticConfig.expo = {
      ...rawStaticConfig.expo,
      ios: {
        ...rawStaticConfig.expo?.ios,
        infoPlist: {
          ...rawStaticConfig.expo?.ios?.infoPlist,
          ITSAppUsesNonExemptEncryption,
        },
      },
    };
  } else {
    rawStaticConfig.ios = {
      ...rawStaticConfig.ios,
      infoPlist: {
        ...rawStaticConfig.ios?.infoPlist,
        ITSAppUsesNonExemptEncryption,
      },
    };
  }
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  exp.ios = {
    ...exp.ios,
    infoPlist: { ...exp.ios?.infoPlist, ITSAppUsesNonExemptEncryption },
  };
}
