import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import Joi from 'joi';

import { Target } from '../../credentials/ios/types';
import { resolveWorkflowAsync } from '../workflow';
import { getBundleIdentifierAsync } from './bundleIdentifier';
import { XcodeBuildContext } from './scheme';

interface UserDefinedTarget {
  targetName: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
}

const AppExtensionsConfigSchema = Joi.array().items(
  Joi.object({
    targetName: Joi.string().required(),
    bundleIdentifier: Joi.string().required(),
    parentBundleIdentifier: Joi.string(),
  })
);

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

  result.push(
    ...(await resolveManagedAppExtensionsAsync({
      exp,
      projectDir,
      buildConfiguration,
      applicationTargetBundleIdentifier: bundleIdentifier,
    }))
  );

  return result;
}

async function resolveManagedAppExtensionsAsync({
  exp,
  projectDir,
  buildConfiguration,
  applicationTargetBundleIdentifier,
}: {
  exp: ExpoConfig;
  projectDir: string;
  buildConfiguration?: string;
  applicationTargetBundleIdentifier: string;
}): Promise<Target[]> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS);
  const managedAppExtensions: UserDefinedTarget[] =
    exp.extra?.eas?.build?.experimental?.ios?.appExtensions;
  if (workflow === Workflow.GENERIC || !managedAppExtensions) {
    return [];
  }

  const { error } = AppExtensionsConfigSchema.validate(managedAppExtensions, {
    allowUnknown: false,
    abortEarly: false,
  });
  if (error) {
    throw new Error(
      `Failed to validate "extra.eas.build.experimental.ios.appExtensions" in you app config\n${error.message}`
    );
  }

  return managedAppExtensions.map(extension => ({
    targetName: extension.targetName,
    buildConfiguration,
    bundleIdentifier: extension.bundleIdentifier,
    parentBundleIdentifier: extension.parentBundleIdentifier ?? applicationTargetBundleIdentifier,
  }));
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
