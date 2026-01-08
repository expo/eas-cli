import path from 'path';

import { AndroidConfig } from '@expo/config-plugins';
import { Android } from '@expo/eas-build-job';
import fs from 'fs-extra';

import { BuildContext } from '../context';
import { EasBuildGradle } from '../templates/EasBuildGradle';
const APPLY_EAS_BUILD_GRADLE_LINE = 'apply from: "./eas-build.gradle"';

export async function configureBuildGradle(ctx: BuildContext<Android.Job>): Promise<void> {
  ctx.logger.info('Injecting signing config into build.gradle');
  if (await fs.pathExists(getEasBuildGradlePath(ctx.getReactNativeProjectDirectory()))) {
    ctx.markBuildPhaseHasWarnings();
    ctx.logger.warn('eas-build.gradle script is deprecated, please remove it from your project.');
  }
  await deleteEasBuildGradle(ctx.getReactNativeProjectDirectory());
  await createEasBuildGradle(ctx.getReactNativeProjectDirectory());
  await addApplyToBuildGradle(ctx.getReactNativeProjectDirectory());
}

async function deleteEasBuildGradle(projectRoot: string): Promise<void> {
  const easBuildGradlePath = getEasBuildGradlePath(projectRoot);
  await fs.remove(easBuildGradlePath);
}

function getEasBuildGradlePath(projectRoot: string): string {
  return path.join(projectRoot, 'android/app/eas-build.gradle');
}

async function createEasBuildGradle(projectRoot: string): Promise<void> {
  const easBuildGradlePath = getEasBuildGradlePath(projectRoot);
  await fs.writeFile(easBuildGradlePath, EasBuildGradle);
}

async function addApplyToBuildGradle(projectRoot: string): Promise<void> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectRoot);
  const buildGradleContents = await fs.readFile(path.join(buildGradlePath), 'utf8');

  if (hasLine(buildGradleContents, APPLY_EAS_BUILD_GRADLE_LINE)) {
    return;
  }

  await fs.writeFile(
    buildGradlePath,
    `${buildGradleContents.trim()}\n${APPLY_EAS_BUILD_GRADLE_LINE}\n`
  );
}

function hasLine(haystack: string, needle: string): boolean {
  return (
    haystack
      .replace(/\r\n/g, '\n')
      .split('\n')
      // Check for both single and double quotes
      .some((line) => line === needle || line === needle.replace(/"/g, "'"))
  );
}
