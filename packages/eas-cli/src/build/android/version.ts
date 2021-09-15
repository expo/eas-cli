import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import {
  getAppBuildGradleAsync,
  parseGradleCommand,
  resolveConfigValue,
} from '../../project/android/gradleUtils';
import { resolveWorkflowAsync } from '../../project/workflow';

export async function maybeResolveVersionsAsync(
  projectDir: string,
  exp: ExpoConfig,
  buildProfile: BuildProfile<Platform.ANDROID>
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
  if (workflow === Workflow.GENERIC) {
    const buildGradle = await getAppBuildGradleAsync(projectDir);
    try {
      const parsedGradleCommand = buildProfile.gradleCommand
        ? parseGradleCommand(buildProfile.gradleCommand, buildGradle)
        : undefined;

      return {
        appVersion:
          resolveConfigValue(buildGradle, 'versionName', parsedGradleCommand?.flavor) ?? '1.0.0',
        appBuildVersion:
          resolveConfigValue(buildGradle, 'versionCode', parsedGradleCommand?.flavor) ?? '1',
      };
    } catch (err: any) {
      return {};
    }
  } else {
    return {
      appBuildVersion: String(AndroidConfig.Version.getVersionCode(exp)),
      appVersion: exp.version,
    };
  }
}
