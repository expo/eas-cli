import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import { errors, readAndValidateBuildConfigFromPathAsync } from '@expo/steps';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { Client } from '../vcs/vcs';

export interface CustomBuildConfigMetadata {
  workflowName?: string;
}

export async function validateCustomBuildConfigAsync({
  profile,
  projectDir,
  vcsClient,
}: {
  projectDir: string;
  profile: BuildProfile<Platform>;
  vcsClient: Client;
}): Promise<CustomBuildConfigMetadata | undefined> {
  if (!profile.config) {
    return undefined;
  }

  const relativeConfigPath = getCustomBuildConfigPath(profile.config);
  const configPath = path.join(projectDir, relativeConfigPath);
  if (!(await fs.pathExists(configPath))) {
    throw new Error(
      `Custom build configuration file ${chalk.bold(relativeConfigPath)} does not exist.`
    );
  }

  const rootDir = path.normalize(await vcsClient.getRootPathAsync());
  if (await vcsClient.isFileIgnoredAsync(path.relative(rootDir, configPath))) {
    throw new Error(
      `Custom build configuration file ${chalk.bold(
        relativeConfigPath
      )} is ignored by your version control system or .easignore. Remove it from the ignore list to successfully create custom build.`
    );
  }

  try {
    const config = await readAndValidateBuildConfigFromPathAsync(configPath, {
      skipNamespacedFunctionsOrFunctionGroupsCheck: true,
    });
    return {
      workflowName: config.build.name,
    };
  } catch (err) {
    if (err instanceof errors.BuildConfigYAMLError) {
      throw new Error(
        `Custom build configuration file ${chalk.bold(
          relativeConfigPath
        )} contains invalid YAML.\n\n${err.message}`
      );
    } else if (err instanceof errors.BuildConfigError) {
      throw new Error(
        `Custom build configuration file ${chalk.bold(
          relativeConfigPath
        )} contains invalid configuration. Please check the docs!\n${err.message}`
      );
    } else {
      throw err;
    }
  }
}

export function getCustomBuildConfigPath(configFilename: string): string {
  return path.join('.eas/build', configFilename);
}

export function getCustomBuildConfigPathForJob(configFilename: string): string {
  return path.posix.join('.eas/build', configFilename);
}
