import { IOSConfig } from '@expo/config-plugins';

export async function isTVOS({
  scheme,
  buildConfiguration,
  workingDir,
}: {
  scheme: string;
  buildConfiguration: string;
  workingDir: string;
}): Promise<boolean> {
  const project = IOSConfig.XcodeUtils.getPbxproj(workingDir);

  const targetName = await IOSConfig.BuildScheme.getApplicationTargetNameForSchemeAsync(
    workingDir,
    scheme
  );

  const xcBuildConfiguration = IOSConfig.Target.getXCBuildConfigurationFromPbxproj(project, {
    targetName,
    buildConfiguration,
  });
  return xcBuildConfiguration?.buildSettings?.SDKROOT?.includes('appletv');
}
