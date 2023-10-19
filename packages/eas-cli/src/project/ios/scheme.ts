import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import chalk from 'chalk';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import sortBy from '../../utils/expodash/sortBy';
import { Client } from '../../vcs/vcs';
import { resolveWorkflowAsync } from '../workflow';

export interface XcodeBuildContext {
  buildScheme: string;
  buildConfiguration?: string;
}

export async function resolveXcodeBuildContextAsync(
  {
    exp,
    projectDir,
    nonInteractive,
    vcsClient,
  }: { exp: ExpoConfig; projectDir: string; nonInteractive: boolean; vcsClient: Client },
  buildProfile: BuildProfile<Platform.IOS>
): Promise<XcodeBuildContext> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);
  if (workflow === Workflow.GENERIC) {
    const buildScheme =
      buildProfile.scheme ??
      (await selectSchemeAsync({
        projectDir,
        nonInteractive,
      }));
    return {
      buildScheme,
      buildConfiguration:
        buildProfile.buildConfiguration ??
        (await IOSConfig.BuildScheme.getArchiveBuildConfigurationForSchemeAsync(
          projectDir,
          buildScheme
        )),
    };
  } else {
    const expoName = exp.name;
    if (!expoName) {
      throw new Error('"expo.name" is required in your app.json');
    }
    const sanitizedExpoName = IOSConfig.XcodeUtils.sanitizedName(expoName);
    if (!sanitizedExpoName) {
      throw new Error('"expo.name" needs to contain some alphanumeric characters');
    }
    return {
      buildScheme: sanitizedExpoName,
    };
  }
}

export async function selectSchemeAsync({
  projectDir,
  nonInteractive = false,
}: {
  projectDir: string;
  nonInteractive: boolean;
}): Promise<string> {
  const schemes = IOSConfig.BuildScheme.getSchemesFromXcodeproj(projectDir);
  if (schemes.length === 0) {
    throw new Error(
      `We did not find any schemes in the Xcode project, make sure that at least one scheme is marked as "shared" in Xcode, and that it's listed in the output of "xcodebuild -list" command`
    );
  }
  if (schemes.length === 1) {
    return schemes[0];
  }

  const sortedSchemes = sortBy(schemes);
  Log.newLine();
  Log.log(
    `We've found multiple schemes in your Xcode project: ${chalk.bold(sortedSchemes.join(', '))}`
  );
  if (nonInteractive) {
    const withoutTvOS = sortedSchemes.filter(i => !i.includes('tvOS'));
    const scheme = withoutTvOS.length > 0 ? withoutTvOS[0] : sortedSchemes[0];
    Log.log(
      `You've run EAS CLI in non-interactive mode, choosing the ${chalk.bold(scheme)} scheme.`
    );
    Log.newLine();
    return scheme;
  } else {
    const { selectedScheme } = await promptAsync({
      type: 'select',
      name: 'selectedScheme',
      message: 'Which scheme would you like to use?',
      choices: sortedSchemes.map(scheme => ({ title: scheme, value: scheme })),
    });
    Log.newLine();
    return selectedScheme as string;
  }
}
