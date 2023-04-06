import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import { errors, readAndValidateBuildConfigAsync } from '@expo/steps';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

export async function validateCustomBuildConfigAsync(
  projectDir: string,
  profile: BuildProfile<Platform>
): Promise<void> {
  if (!profile.config) {
    return;
  }

  const relativeConfigPath = getCustomBuildConfigPath(profile.config);
  const configPath = path.join(projectDir, relativeConfigPath);
  if (!(await fs.pathExists(configPath))) {
    throw new Error(
      `Custom build configuration file ${chalk.bold(relativeConfigPath)} does not exist.`
    );
  }

  try {
    await readAndValidateBuildConfigAsync(configPath, { skipNamespacedFunctionsCheck: true });
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
