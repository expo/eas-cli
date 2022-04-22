import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { JSONObject } from '@expo/json-file';
import Joi from 'joi';

import { Target } from '../../credentials/ios/types';
import { resolveWorkflowAsync } from '../workflow';
import { getBundleIdentifierAsync } from './bundleIdentifier';
import {
  getManagedApplicationTargetEntitlementsAsync,
  getNativeTargetEntitlementsAsync,
} from './entitlements';
import { XcodeBuildContext } from './scheme';

interface UserDefinedTarget {
  targetName: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
  entitlements?: JSONObject;
}

interface ResolveTargetOptions {
  projectDir: string;
  exp: ExpoConfig;
  env: Record<string, string>;
  xcodeBuildContext: XcodeBuildContext;
}

const AppExtensionsConfigSchema = Joi.array().items(
  Joi.object({
    targetName: Joi.string().required(),
    bundleIdentifier: Joi.string().required(),
    parentBundleIdentifier: Joi.string(),
    entitlements: Joi.object(),
  })
);

export async function resolveMangedProjectTargetsAsync({
  exp,
  projectDir,
  xcodeBuildContext,
  env,
}: ResolveTargetOptions): Promise<Target[]> {
  const { buildScheme, buildConfiguration } = xcodeBuildContext;
  const applicationTargetName = buildScheme;
  const applicationTargetBundleIdentifier = await getBundleIdentifierAsync(projectDir, exp, {
    targetName: applicationTargetName,
    buildConfiguration,
  });
  const applicationTargetEntitlements = await getManagedApplicationTargetEntitlementsAsync(
    projectDir,
    env
  );
  const appExtensions: UserDefinedTarget[] =
    exp.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];

  const { error } = AppExtensionsConfigSchema.validate(appExtensions, {
    allowUnknown: false,
    abortEarly: false,
  });
  if (error) {
    throw new Error(
      `Failed to validate "extra.eas.build.experimental.ios.appExtensions" in you app config.\n${error.message}`
    );
  }

  const extensionsTargets: Target[] = appExtensions.map(extension => ({
    targetName: extension.targetName,
    buildConfiguration,
    bundleIdentifier: extension.bundleIdentifier,
    parentBundleIdentifier: extension.parentBundleIdentifier ?? applicationTargetBundleIdentifier,
    entitlements: extension.entitlements ?? {},
  }));
  return [
    {
      targetName: applicationTargetName,
      bundleIdentifier: applicationTargetBundleIdentifier,
      buildConfiguration,
      entitlements: applicationTargetEntitlements,
    },
    ...extensionsTargets,
  ];
}

export async function resolveBareProjectTargetsAsync({
  exp,
  projectDir,
  xcodeBuildContext,
}: ResolveTargetOptions): Promise<Target[]> {
  const { buildScheme, buildConfiguration } = xcodeBuildContext;
  const result: Target[] = [];

  const applicationTarget = await IOSConfig.Target.findApplicationTargetWithDependenciesAsync(
    projectDir,
    buildScheme
  );
  const bundleIdentifier = await getBundleIdentifierAsync(projectDir, exp, {
    targetName: applicationTarget.name,
    buildConfiguration,
  });
  const entitlements = await getNativeTargetEntitlementsAsync(projectDir, {
    targetName: applicationTarget.name,
    buildConfiguration,
  });
  result.push({
    targetName: applicationTarget.name,
    bundleIdentifier,
    buildConfiguration,
    entitlements: entitlements ?? {},
  });

  const dependencies = await resolveBareProjectDependenciesAsync({
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

export async function resolveTargetsAsync(opts: ResolveTargetOptions): Promise<Target[]> {
  const workflow = await resolveWorkflowAsync(opts.projectDir, Platform.IOS);
  if (workflow === Workflow.GENERIC) {
    return await resolveBareProjectTargetsAsync(opts);
  } else if (workflow === Workflow.MANAGED) {
    return await resolveMangedProjectTargetsAsync(opts);
  } else {
    throw new Error(`Unknown workflow: ${workflow}`);
  }
}

async function resolveBareProjectDependenciesAsync({
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
      const entitlements = await getNativeTargetEntitlementsAsync(projectDir, {
        targetName: target.name,
        buildConfiguration,
      });
      result.push({
        targetName: dependency.name,
        buildConfiguration,
        bundleIdentifier: dependencyBundleIdentifier,
        parentBundleIdentifier: bundleIdentifier,
        entitlements: entitlements ?? {},
      });
      const dependencyDependencies = await resolveBareProjectDependenciesAsync({
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
