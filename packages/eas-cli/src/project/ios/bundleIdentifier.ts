import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';

import { readAppJson } from '../../build/utils/appJson';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import env from '../../env';
import Log, { learnMore } from '../../log';
import { promptAsync } from '../../prompts';
import { Client } from '../../vcs/vcs';
import { getOwnerAccountForProjectIdAsync, getProjectConfigDescription } from '../projectUtils';
import { resolveWorkflowAsync } from '../workflow';

export const INVALID_BUNDLE_IDENTIFIER_MESSAGE = `Invalid format of iOS bundle identifier. Only alphanumeric characters, '.' and '-' are allowed, and each '.' must be followed by a letter.`;

export async function ensureBundleIdentifierIsDefinedForManagedProjectAsync({
  graphqlClient,
  projectDir,
  projectId,
  exp,
  vcsClient,
  nonInteractive,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  vcsClient: Client;
  nonInteractive: boolean;
}): Promise<string> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);
  assert(workflow === Workflow.MANAGED, 'This function should be called only for managed projects');

  try {
    return await getBundleIdentifierAsync(projectDir, exp, vcsClient);
  } catch {
    return await configureBundleIdentifierAsync({
      graphqlClient,
      projectDir,
      exp,
      projectId,
      nonInteractive,
    });
  }
}

export class AmbiguousBundleIdentifierError extends Error {
  constructor(message?: string) {
    super(message ?? 'Could not resolve bundle identifier.');
  }
}

export async function getBundleIdentifierAsync(
  projectDir: string,
  exp: ExpoConfig,
  vcsClient: Client,
  xcodeContext?: { targetName?: string; buildConfiguration?: string }
): Promise<string> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);
  if (workflow === Workflow.GENERIC) {
    warnIfBundleIdentifierDefinedInAppConfigForBareWorkflowProject(projectDir, exp);

    if (env.overrideIosBundleIdentifier) {
      return env.overrideIosBundleIdentifier;
    }

    const xcodeProject = IOSConfig.XcodeUtils.getPbxproj(projectDir);
    const isMultiScheme = IOSConfig.BuildScheme.getSchemesFromXcodeproj(projectDir).length > 1;
    const isMultiTarget =
      IOSConfig.Target.getNativeTargets(xcodeProject).filter(([, target]) =>
        IOSConfig.Target.isTargetOfType(target, IOSConfig.Target.TargetType.APPLICATION)
      ).length > 1;
    if (!xcodeContext && isMultiScheme && isMultiTarget) {
      throw new AmbiguousBundleIdentifierError(
        "Multiple schemes and targets found in Xcode project, bundle identifier couldn't be resolved."
      );
    }
    const bundleIdentifier = IOSConfig.BundleIdentifier.getBundleIdentifierFromPbxproj(
      projectDir,
      xcodeContext ?? {}
    );
    const buildConfigurationDesc =
      xcodeContext?.targetName && xcodeContext?.buildConfiguration
        ? ` (target = ${xcodeContext.targetName}, build configuration = ${xcodeContext.buildConfiguration})`
        : '';
    assert(
      bundleIdentifier,
      `Could not read bundle identifier from Xcode project${buildConfigurationDesc}.`
    );
    if (!isBundleIdentifierValid(bundleIdentifier)) {
      throw new Error(
        `Bundle identifier "${bundleIdentifier}" is not valid${buildConfigurationDesc}. Open the project in Xcode to fix it.`
      );
    }
    return bundleIdentifier;
  } else {
    // TODO: the following asserts are only temporary until we support app extensions in managed projects
    assert(
      !xcodeContext?.targetName ||
        xcodeContext?.targetName === IOSConfig.XcodeUtils.sanitizedName(exp.name),
      'targetName cannot be set to an arbitrary value for managed projects.'
    );
    assert(
      !xcodeContext?.buildConfiguration,
      'buildConfiguration cannot be passed for managed projects.'
    );
    const bundleIdentifier = IOSConfig.BundleIdentifier.getBundleIdentifier(exp);
    if (!bundleIdentifier || !isBundleIdentifierValid(bundleIdentifier)) {
      if (bundleIdentifier) {
        Log.warn(INVALID_BUNDLE_IDENTIFIER_MESSAGE);
      }
      throw new Error(
        `Specify "ios.bundleIdentifier" in ${getProjectConfigDescription(
          projectDir
        )} and run this command again.`
      );
    } else {
      return bundleIdentifier;
    }
  }
}

async function configureBundleIdentifierAsync({
  graphqlClient,
  projectDir,
  projectId,
  exp,
  nonInteractive,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  nonInteractive: boolean;
}): Promise<string> {
  if (nonInteractive) {
    throw new Error(
      `The "ios.bundleIdentifier" is required to be set in app config when running in non-interactive mode. ${learnMore(
        'https://docs.expo.dev/versions/latest/config/app/#bundleidentifier'
      )}`
    );
  }

  const paths = getConfigFilePaths(projectDir);
  // we can't automatically update app.config.js
  if (paths.dynamicConfigPath) {
    throw new Error(
      `"ios.bundleIdentifier" is not defined in your app.config.js and we can't update this file programmatically. Add the value on your own and run this command again.`
    );
  }

  assert(paths.staticConfigPath, 'app.json must exist');

  Log.addNewLineIfNone();
  Log.log(
    `${chalk.bold(`📝  iOS Bundle Identifier`)} ${chalk.dim(
      learnMore('https://expo.fyi/bundle-identifier')
    )}`
  );

  const suggestedBundleIdentifier = await getSuggestedBundleIdentifierAsync(
    graphqlClient,
    exp,
    projectId
  );

  const { bundleIdentifier } = await promptAsync({
    name: 'bundleIdentifier',
    type: 'text',
    message: `What would you like your iOS bundle identifier to be?`,
    initial: suggestedBundleIdentifier,
    validate: value => (isBundleIdentifierValid(value) ? true : INVALID_BUNDLE_IDENTIFIER_MESSAGE),
  });

  const rawStaticConfig = readAppJson(paths.staticConfigPath);
  rawStaticConfig.expo = {
    ...rawStaticConfig.expo,
    ios: { ...rawStaticConfig.expo?.ios, bundleIdentifier },
  };
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  exp.ios = { ...exp.ios, bundleIdentifier };

  return bundleIdentifier;
}

export function isBundleIdentifierValid(bundleIdentifier: string): boolean {
  return /^[a-zA-Z0-9-.]+$/.test(bundleIdentifier);
}

let warnPrinted = false;
export function warnIfBundleIdentifierDefinedInAppConfigForBareWorkflowProject(
  projectDir: string,
  exp: ExpoConfig
): void {
  if (IOSConfig.BundleIdentifier.getBundleIdentifier(exp) && !warnPrinted) {
    Log.warn(
      `Specified value for "ios.bundleIdentifier" in ${getProjectConfigDescription(
        projectDir
      )} is ignored because an ${chalk.bold('ios')} directory was detected in the project.\n` +
        'EAS Build will use the value found in the native code.'
    );
    warnPrinted = true;
  }
}

export function isWildcardBundleIdentifier(bundleIdentifier: string): boolean {
  const wildcardRegex = /^[A-Za-z0-9.-]+\*$/;
  return wildcardRegex.test(bundleIdentifier);
}

async function getSuggestedBundleIdentifierAsync(
  graphqlClient: ExpoGraphqlClient,
  exp: ExpoConfig,
  projectId: string
): Promise<string | undefined> {
  // Attempt to use the android package name first since it's convenient to have them aligned.
  const maybeAndroidPackage = AndroidConfig.Package.getPackage(exp);
  if (maybeAndroidPackage && isBundleIdentifierValid(maybeAndroidPackage)) {
    return maybeAndroidPackage;
  } else {
    // the only callsite is heavily interactive
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    let possibleId: string;
    // It's common to use dashes in your node project name, strip them from the suggested package name.
    if (account.name) {
      possibleId = `com.${account.name}.${exp.slug}`.split('-').join('');
    } else {
      possibleId = `com.${exp.slug}`.split('-').join('');
    }

    if (isBundleIdentifierValid(possibleId)) {
      return possibleId;
    }
  }
  return undefined;
}
