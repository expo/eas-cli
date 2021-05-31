import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import chalk from 'chalk';
import sortBy from 'lodash/sortBy';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import { sanitizedProjectName } from '../projectUtils';
import { resolveWorkflow } from '../workflow';

export interface XcodeBuildContext {
  buildScheme: string;
  buildConfiguration?: string;
}

export async function resolveXcodeBuildContextAsync(
  {
    exp,
    projectDir,
    nonInteractive,
  }: { exp: ExpoConfig; projectDir: string; nonInteractive: boolean },
  {
    workflow: _workflow,
    buildScheme: _buildScheme,
    buildConfiguration,
  }: {
    buildScheme?: string;
    buildConfiguration?: string;
    workflow?: Workflow;
  } = {}
): Promise<XcodeBuildContext> {
  const workflow = _workflow ?? resolveWorkflow(projectDir, Platform.IOS);
  if (workflow === Workflow.GENERIC) {
    const buildScheme =
      _buildScheme ??
      (await selectSchemeAsync({
        projectDir,
        nonInteractive,
      }));
    return {
      buildScheme,
      buildConfiguration:
        buildConfiguration ??
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
    const sanitizedExpoName = sanitizedProjectName(expoName);
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
  nonInteractive?: boolean;
}): Promise<string> {
  const schemes = IOSConfig.BuildScheme.getSchemesFromXcodeproj(projectDir);
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
      `You've run Expo CLI in non-interactive mode, choosing the ${chalk.bold(scheme)} scheme.`
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
