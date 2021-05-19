import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';

import { resolveWorkflow } from '../../project/workflow';

export function readVersionCode(projectDir: string, exp: ExpoConfig): number | undefined {
  const workflow = resolveWorkflow(projectDir, Platform.ANDROID);
  if (workflow === Workflow.GENERIC) {
    const buildGradlePath = AndroidConfig.Paths.getAppBuildGradle(projectDir);
    if (!fs.pathExistsSync(buildGradlePath)) {
      return undefined;
    }
    const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
    const matchResult = buildGradle.match(/versionCode (.*)/);
    if (matchResult) {
      return Number(matchResult[1]);
    } else {
      return undefined;
    }
  } else {
    return AndroidConfig.Version.getVersionCode(exp) ?? undefined;
  }
}
