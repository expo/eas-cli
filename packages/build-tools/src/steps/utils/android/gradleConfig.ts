import path from 'path';

import { AndroidConfig } from '@expo/config-plugins';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import { templateString } from '@expo/template-file';

import { EasBuildInjectAndroidCredentialsGradle } from '../../../templates/EasBuildInjectAndroidCredentialsGradle';
import { EasBuildConfigureVersionGradleTemplate } from '../../../templates/EasBuildConfigureVersionGradle';

const APPLY_EAS_BUILD_INJECT_CREDENTIALS_GRADLE_LINE =
  'apply from: "./eas-build-inject-android-credentials.gradle"';
const APPLY_EAS_BUILD_CONFIGURE_VERSION_GRADLE_LINE =
  'apply from: "./eas-build-configure-version.gradle"';

export async function injectCredentialsGradleConfig(
  logger: bunyan,
  workingDir: string
): Promise<void> {
  logger.info('Injecting signing config into build.gradle');
  await deleteEasBuildInjectCredentialsGradle(workingDir);
  await createEasBuildInjectCredentialsGradle(workingDir);
  await addApplyInjectCredentialsConfigToBuildGradle(workingDir);
  logger.info('Signing config injected');
}

export async function injectConfigureVersionGradleConfig(
  logger: bunyan,
  workingDir: string,
  { versionCode, versionName }: { versionCode?: string; versionName?: string }
): Promise<void> {
  logger.info('Injecting version config into build.gradle');
  if (versionCode) {
    logger.info(`Version code: ${versionCode}`);
  }
  if (versionName) {
    logger.info(`Version name: ${versionName}`);
  }
  await deleteEasBuildConfigureVersionGradle(workingDir);
  await createEasBuildConfigureVersionGradle(workingDir, { versionCode, versionName });
  await addApplyConfigureVersionConfigToBuildGradle(workingDir);
  logger.info('Version config injected');
}

async function deleteEasBuildInjectCredentialsGradle(workingDir: string): Promise<void> {
  const targetPath = getEasBuildInjectCredentialsGradlePath(workingDir);
  await fs.remove(targetPath);
}

async function deleteEasBuildConfigureVersionGradle(workingDir: string): Promise<void> {
  const targetPath = getEasBuildConfigureVersionGradlePath(workingDir);
  await fs.remove(targetPath);
}

function getEasBuildInjectCredentialsGradlePath(workingDir: string): string {
  return path.join(workingDir, 'android/app/eas-build-inject-android-credentials.gradle');
}

function getEasBuildConfigureVersionGradlePath(workingDir: string): string {
  return path.join(workingDir, 'android/app/eas-build-configure-version.gradle');
}

async function createEasBuildInjectCredentialsGradle(workingDir: string): Promise<void> {
  const targetPath = getEasBuildInjectCredentialsGradlePath(workingDir);
  await fs.writeFile(targetPath, EasBuildInjectAndroidCredentialsGradle);
}

async function createEasBuildConfigureVersionGradle(
  workingDir: string,
  { versionCode, versionName }: { versionCode?: string; versionName?: string }
): Promise<void> {
  const targetPath = getEasBuildConfigureVersionGradlePath(workingDir);
  const output = templateString({
    input: EasBuildConfigureVersionGradleTemplate,
    vars: {
      VERSION_CODE: versionCode,
      VERSION_NAME: versionName,
    },
    mustache: false,
  });
  await fs.writeFile(targetPath, output);
}

async function addApplyInjectCredentialsConfigToBuildGradle(projectRoot: string): Promise<void> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectRoot);
  const buildGradleContents = await fs.readFile(path.join(buildGradlePath), 'utf8');

  if (hasLine(buildGradleContents, APPLY_EAS_BUILD_INJECT_CREDENTIALS_GRADLE_LINE)) {
    return;
  }

  await fs.writeFile(
    buildGradlePath,
    `${buildGradleContents.trim()}\n${APPLY_EAS_BUILD_INJECT_CREDENTIALS_GRADLE_LINE}\n`
  );
}

async function addApplyConfigureVersionConfigToBuildGradle(projectRoot: string): Promise<void> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectRoot);
  const buildGradleContents = await fs.readFile(path.join(buildGradlePath), 'utf8');

  if (hasLine(buildGradleContents, APPLY_EAS_BUILD_CONFIGURE_VERSION_GRADLE_LINE)) {
    return;
  }

  await fs.writeFile(
    buildGradlePath,
    `${buildGradleContents.trim()}\n${APPLY_EAS_BUILD_CONFIGURE_VERSION_GRADLE_LINE}\n`
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
