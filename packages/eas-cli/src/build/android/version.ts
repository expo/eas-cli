import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';

import { resolveWorkflow } from '../../project/workflow';

export function readVersionCode(projectDir: string, exp: ExpoConfig): number | undefined {
  const workflow = resolveWorkflow(projectDir, Platform.ANDROID);
  if (workflow === Workflow.GENERIC) {
    const buildGradle = readBuildGradle(projectDir);
    const matchResult = buildGradle?.match(/versionCode (.*)/);
    if (matchResult) {
      return Number(matchResult[1]);
    } else {
      return undefined;
    }
  } else {
    return AndroidConfig.Version.getVersionCode(exp) ?? undefined;
  }
}

export function readVersionName(projectDir: string, exp: ExpoConfig): string | undefined {
  const workflow = resolveWorkflow(projectDir, Platform.ANDROID);
  if (workflow === Workflow.GENERIC) {
    const buildGradle = readBuildGradle(projectDir);
    const matchResult = buildGradle?.match(/versionName ["'](.*)["']/);
    if (matchResult) {
      return matchResult[1];
    } else {
      return undefined;
    }
  } else {
    return exp.version;
  }
}

function readBuildGradle(projectDir: string): string | undefined {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradle(projectDir);
  if (!fs.pathExistsSync(buildGradlePath)) {
    return undefined;
  }
  return fs.readFileSync(buildGradlePath, 'utf8');
}
