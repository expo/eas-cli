import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';

import { Target } from '../../credentials/ios/types';
import { resolveWorkflow } from '../workflow';
import { getBundleIdentifier } from './bundleIdentifier';
import { XcodeBuildContext } from './scheme';

export async function resolveTargetsAsync(
  { exp, projectDir }: { exp: ExpoConfig; projectDir: string },
  { buildConfiguration, buildScheme }: XcodeBuildContext
): Promise<Target[]> {
  const result: Target[] = [];

  const applicationTarget = await getApplicationTargetAsync(projectDir, buildScheme);
  const bundleIdentifier = getBundleIdentifier(projectDir, exp, {
    targetName: applicationTarget.name,
    buildConfiguration,
  });
  result.push({
    targetName: applicationTarget.name,
    bundleIdentifier,
  });

  if (applicationTarget.dependencies && applicationTarget.dependencies.length > 0) {
    for (const dependency of applicationTarget.dependencies) {
      result.push({
        targetName: dependency.name,
        bundleIdentifier: getBundleIdentifier(projectDir, exp, {
          targetName: dependency.name,
          buildConfiguration,
        }),
        parentBundleIdentifier: bundleIdentifier,
      });
    }
  }

  return result;
}

async function getApplicationTargetAsync(
  projectDir: string,
  scheme: string
): Promise<IOSConfig.Target.Target> {
  const workflow = resolveWorkflow(projectDir, Platform.IOS);
  if (workflow === Workflow.GENERIC) {
    return await IOSConfig.Target.findApplicationTargetWithDependenciesAsync(projectDir, scheme);
  } else {
    return {
      name: scheme,
      type: IOSConfig.Target.TargetType.APPLICATION,
      dependencies: [],
    };
  }
}
