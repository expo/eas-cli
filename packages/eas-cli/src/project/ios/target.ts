import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';

import { Target } from '../../credentials/ios/types';
import { resolveWorkflowAsync } from '../workflow';
import { getBundleIdentifierAsync } from './bundleIdentifier';
import { XcodeBuildContext } from './scheme';

export async function resolveTargetsAsync(
  { exp, projectDir }: { exp: ExpoConfig; projectDir: string },
  { buildConfiguration, buildScheme }: XcodeBuildContext
): Promise<Target[]> {
  const result: Target[] = [];

  const applicationTarget = await readApplicationTargetForSchemeAsync(projectDir, buildScheme);
  const bundleIdentifier = await getBundleIdentifierAsync(projectDir, exp, {
    targetName: applicationTarget.name,
    buildConfiguration,
  });
  result.push({
    targetName: applicationTarget.name,
    bundleIdentifier,
    buildConfiguration,
  });

  const dependencies = await resolveDependenciesAsync({
    exp,
    projectDir,
    buildConfiguration,
    target: applicationTarget,
    bundleIdentifier,
  });
  if (dependencies.length > 0) {
    result.push(...dependencies);
  }

  return result;
}

async function resolveDependenciesAsync({
  exp,
  projectDir,
  buildConfiguration,
  target,
  bundleIdentifier,
}: {
  exp: ExpoConfig;
  projectDir: string;
  buildConfiguration?: string;
  target: IOSConfig.Target.Target;
  bundleIdentifier: string;
}): Promise<Target[]> {
  const result: Target[] = [];

  if (target.dependencies && target.dependencies.length > 0) {
    for (const dependency of target.dependencies) {
      const dependencyBundleIdentifier = await getBundleIdentifierAsync(projectDir, exp, {
        targetName: dependency.name,
        buildConfiguration,
      });
      result.push({
        targetName: dependency.name,
        buildConfiguration,
        bundleIdentifier: dependencyBundleIdentifier,
        parentBundleIdentifier: bundleIdentifier,
      });
      const dependencyDependencies = await resolveDependenciesAsync({
        exp,
        projectDir,
        buildConfiguration,
        target: dependency,
        bundleIdentifier: dependencyBundleIdentifier,
      });
      if (dependencyDependencies.length > 0) {
        result.push(...dependencyDependencies);
      }
    }
  }

  return result;
}

async function readApplicationTargetForSchemeAsync(
  projectDir: string,
  scheme: string
): Promise<IOSConfig.Target.Target> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS);
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

export function findApplicationTarget(targets: Target[]): Target {
  const applicationTarget = targets.find(({ parentBundleIdentifier }) => !parentBundleIdentifier);
  if (!applicationTarget) {
    throw new Error('Could not find the application target');
  }
  return applicationTarget;
}

export function findTargetByName(targets: Target[], name: string): Target {
  const target = targets.find(target => target.targetName === name);
  if (!target) {
    throw new Error(`Could not find target '${name}'`);
  }
  return target;
}
