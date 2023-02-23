import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
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

  const relativeBuildConfigPath = getCustomBuildConfigPath(profile.config);
  const buildConfigPath = path.join(projectDir, relativeBuildConfigPath);
  if (!(await fs.pathExists(buildConfigPath))) {
    throw new Error(
      `Custom build configuration file ${chalk.bold(relativeBuildConfigPath)} does not exist.`
    );
  }
}

export function getCustomBuildConfigPath(configFilename: string): string {
  return path.join('.eas/build', configFilename);
}
