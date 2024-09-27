import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import * as gradleUtils from './gradleUtils';
import Log from '../../log';
import { resolveWorkflowAsync } from '../../project/workflow';
import { Client } from '../../vcs/vcs';

export interface GradleBuildContext {
  moduleName?: string;
  flavor?: string;
}

export async function resolveGradleBuildContextAsync(
  projectDir: string,
  buildProfile: BuildProfile<Platform.ANDROID>,
  vcsClient: Client
): Promise<GradleBuildContext | undefined> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient);
  if (workflow === Workflow.GENERIC) {
    try {
      if (buildProfile.gradleCommand) {
        const buildGradle = await gradleUtils.getAppBuildGradleAsync(projectDir);
        const parsedGradleCommand = buildProfile.gradleCommand
          ? gradleUtils.parseGradleCommand(buildProfile.gradleCommand, buildGradle)
          : undefined;
        if (
          parsedGradleCommand?.moduleName &&
          parsedGradleCommand.moduleName !== gradleUtils.DEFAULT_MODULE_NAME
        ) {
          Log.warn(
            `Building modules different than "${gradleUtils.DEFAULT_MODULE_NAME}" might result in unexpected behavior.`
          );
        }
        return {
          moduleName: parsedGradleCommand?.moduleName ?? gradleUtils.DEFAULT_MODULE_NAME,
          flavor: parsedGradleCommand?.flavor,
        };
      } else {
        return { moduleName: gradleUtils.DEFAULT_MODULE_NAME };
      }
    } catch (err: any) {
      Log.warn(`Unable to read gradle project config: ${err.message}.`);
      Log.warn('Values from app/build.gradle might be resolved incorrectly.');
      return undefined;
    }
  } else {
    return { moduleName: gradleUtils.DEFAULT_MODULE_NAME };
  }
}
