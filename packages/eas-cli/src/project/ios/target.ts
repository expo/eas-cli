import { ExpoConfig } from '@expo/config';
import { IOSConfig, XcodeProject } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { JSONObject } from '@expo/json-file';
import Joi from 'joi';
import type { XCBuildConfiguration } from 'xcode';

import { getBundleIdentifierAsync } from './bundleIdentifier';
import {
  getManagedApplicationTargetEntitlementsAsync,
  getNativeTargetEntitlementsAsync,
} from './entitlements';
import { XcodeBuildContext } from './scheme';
import { ApplePlatform } from '../../credentials/ios/appstore/constants';
import { Target } from '../../credentials/ios/types';
import { Client } from '../../vcs/vcs';
import { resolveWorkflowAsync } from '../workflow';

interface UserDefinedTarget {
  targetName: string;
  bundleIdentifier: string;
  parentBundleIdentifier?: string;
  entitlements?: JSONObject;
}

interface ResolveTargetOptions {
  projectDir: string;
  exp: ExpoConfig;
  env?: Record<string, string>;
  xcodeBuildContext: XcodeBuildContext;
  vcsClient: Client;
}

const AppExtensionsConfigSchema = Joi.array().items(
  Joi.object({
    targetName: Joi.string().required(),
    bundleIdentifier: Joi.string().required(),
    parentBundleIdentifier: Joi.string(),
    entitlements: Joi.object(),
  })
);

export async function resolveManagedProjectTargetsAsync({
  exp,
  projectDir,
  xcodeBuildContext,
  env,
  vcsClient,
}: ResolveTargetOptions): Promise<Target[]> {
  const { buildScheme, buildConfiguration } = xcodeBuildContext;
  const applicationTargetName = buildScheme;
  const applicationTargetBundleIdentifier = await getBundleIdentifierAsync(
    projectDir,
    exp,
    vcsClient,
    {
      targetName: applicationTargetName,
      buildConfiguration,
    }
  );
  const applicationTargetEntitlements = await getManagedApplicationTargetEntitlementsAsync(
    projectDir,
    env ?? {},
    vcsClient
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
  vcsClient,
}: ResolveTargetOptions): Promise<Target[]> {
  const { buildScheme, buildConfiguration } = xcodeBuildContext;
  const result: Target[] = [];

  const pbxProject = IOSConfig.XcodeUtils.getPbxproj(projectDir);
  const applicationTarget = await IOSConfig.Target.findApplicationTargetWithDependenciesAsync(
    projectDir,
    buildScheme
  );
  const bundleIdentifier = await getBundleIdentifierAsync(projectDir, exp, vcsClient, {
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
    buildSettings: resolveBareProjectBuildSettings(
      pbxProject,
      applicationTarget.name,
      buildConfiguration
    ),
  });

  const dependencies = await resolveBareProjectDependenciesAsync({
    exp,
    projectDir,
    buildConfiguration,
    target: applicationTarget,
    bundleIdentifier,
    pbxProject,
    vcsClient,
  });
  if (dependencies.length > 0) {
    result.push(...dependencies);
  }

  return result;
}

export async function resolveTargetsAsync(opts: ResolveTargetOptions): Promise<Target[]> {
  const workflow = await resolveWorkflowAsync(opts.projectDir, Platform.IOS, opts.vcsClient);
  if (workflow === Workflow.GENERIC) {
    return await resolveBareProjectTargetsAsync(opts);
  } else if (workflow === Workflow.MANAGED) {
    return await resolveManagedProjectTargetsAsync(opts);
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
  pbxProject,
  vcsClient,
}: {
  exp: ExpoConfig;
  projectDir: string;
  buildConfiguration?: string;
  target: IOSConfig.Target.Target;
  bundleIdentifier: string;
  pbxProject: XcodeProject;
  vcsClient: Client;
}): Promise<Target[]> {
  const result: Target[] = [];

  if (target.dependencies && target.dependencies.length > 0) {
    for (const dependency of target.dependencies) {
      if (!dependency.signable) {
        continue;
      }
      const dependencyBundleIdentifier = await getBundleIdentifierAsync(
        projectDir,
        exp,
        vcsClient,
        {
          targetName: dependency.name,
          buildConfiguration,
        }
      );
      const entitlements = await getNativeTargetEntitlementsAsync(projectDir, {
        targetName: dependency.name,
        buildConfiguration,
      });
      result.push({
        targetName: dependency.name,
        buildConfiguration,
        bundleIdentifier: dependencyBundleIdentifier,
        parentBundleIdentifier: bundleIdentifier,
        entitlements: entitlements ?? {},
        buildSettings: resolveBareProjectBuildSettings(
          pbxProject,
          dependency.name,
          buildConfiguration
        ),
      });
      const dependencyDependencies = await resolveBareProjectDependenciesAsync({
        exp,
        projectDir,
        buildConfiguration,
        target: dependency,
        bundleIdentifier: dependencyBundleIdentifier,
        pbxProject,
        vcsClient,
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

function resolveBareProjectBuildSettings(
  project: XcodeProject,
  targetName: string,
  buildConfiguration?: string
): XCBuildConfiguration['buildSettings'] {
  const xcBuildConfiguration = IOSConfig.Target.getXCBuildConfigurationFromPbxproj(project, {
    targetName,
    buildConfiguration,
  });
  return xcBuildConfiguration?.buildSettings ?? {};
}

/**
 * Get Apple Platform from the Xcode Target where possible.
 * @returns - Apple Platform when known, defaults to IOS when unknown
 */
export function getApplePlatformFromTarget(target: Target): ApplePlatform {
  return (
    getApplePlatformFromSdkRoot(target) ??
    getApplePlatformFromDeviceFamily(target) ??
    ApplePlatform.IOS
  );
}

/**
 * Get Apple Platform from the Xcode SDKROOT where possible.
 * @returns - Apple Platform when known, defaults to null when unknown
 */
export function getApplePlatformFromSdkRoot(target: Target): ApplePlatform | null {
  const sdkRoot = target.buildSettings?.SDKROOT;
  if (!sdkRoot) {
    return null;
  }
  if (sdkRoot.includes('iphoneos')) {
    return ApplePlatform.IOS;
  } else if (sdkRoot.includes('tvos')) {
    return ApplePlatform.TV_OS;
  } else if (sdkRoot.includes('macosx')) {
    return ApplePlatform.MAC_OS;
  } else {
    return null;
  }
}

/**
 * Get Apple Platform from the Xcode TARGETED_DEVICE_FAMILY where possible.
 *
 * References:
 * https://developer-mdn.apple.com/library/archive/documentation/DeveloperTools/Reference/XcodeBuildSettingRef/1-Build_Setting_Reference/build_setting_ref.html
 * https://stackoverflow.com/questions/39677524/xcode-8-how-to-change-targeted-device-family#comment100316573_39677659
 *
 * @returns - Apple Platform when known, defaults to null when unknown
 */
export function getApplePlatformFromDeviceFamily(target: Target): ApplePlatform | null {
  const deviceFamily = target.buildSettings?.TARGETED_DEVICE_FAMILY;
  if (!deviceFamily) {
    return null;
  }
  if (typeof deviceFamily === 'string') {
    const devices = deviceFamily.split(',');
    const arbitraryDevice = devices[0];
    const deviceFamilyNumber = Number(arbitraryDevice);
    return deviceFamilyToPlatform(deviceFamilyNumber);
  } else if (typeof deviceFamily === 'number') {
    return deviceFamilyToPlatform(deviceFamily);
  }
  throw new Error(
    `Unexpected device family type in XCode build settings: ${JSON.stringify(deviceFamily)}`
  );
}

function deviceFamilyToPlatform(deviceFamily: number): ApplePlatform | null {
  if (deviceFamily === 1 || deviceFamily === 2) {
    return ApplePlatform.IOS;
  } else if (deviceFamily === 3) {
    return ApplePlatform.TV_OS;
  } else {
    return null;
  }
}
