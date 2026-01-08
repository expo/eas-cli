import { Ios } from '@expo/eas-build-job';
import { IOSConfig } from '@expo/config-plugins';

import { BuildContext } from '../context';

import { resolveBuildConfiguration, resolveScheme } from './resolve';

// Functions specific to Apple TV support should be added here

/**
 * Use XcodeUtils to check if a build configuration is for Apple TV and not iOS
 *
 * @param ctx The build context
 * @returns true if this is an Apple TV configuration, false otherwise
 */
export async function isTVOS(ctx: BuildContext<Ios.Job>): Promise<boolean> {
  const scheme = resolveScheme(ctx);

  const project = IOSConfig.XcodeUtils.getPbxproj(ctx.getReactNativeProjectDirectory());

  const targetName = await IOSConfig.BuildScheme.getApplicationTargetNameForSchemeAsync(
    ctx.getReactNativeProjectDirectory(),
    scheme
  );

  const buildConfiguration = resolveBuildConfiguration(ctx);

  const xcBuildConfiguration = IOSConfig.Target.getXCBuildConfigurationFromPbxproj(project, {
    targetName,
    buildConfiguration,
  });
  return xcBuildConfiguration?.buildSettings?.SDKROOT?.includes('appletv');
}
