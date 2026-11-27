import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { z } from 'zod';

const ShowBuildSettingsOutputZ = z.array(
  z.object({
    target: z.string(),
    buildSettings: z.record(z.string(), z.string()),
  })
);

interface BuildSettingsQuery {
  xcodeprojPath: string;
  targetNames: string[];
  buildConfiguration: string;
  sdk?: string;
  env: BuildStepEnv;
  logger: bunyan;
}

type BuildSettingsByTargetName = Record<string, Record<string, string>>;

export async function readBuildSettingsByTargetNameAsync(
  query: BuildSettingsQuery
): Promise<BuildSettingsByTargetName> {
  const buildSettingsByTargetName = await showBuildSettingsAsync(query);
  // Without -sdk, xcodebuild resolves no platform for a target that has SDKROOT = auto.
  const targetNamesWithoutPlatform = query.targetNames.filter(
    targetName => !buildSettingsByTargetName[targetName]?.PLATFORM_NAME
  );
  if (targetNamesWithoutPlatform.length === 0) {
    return buildSettingsByTargetName;
  }
  return {
    ...buildSettingsByTargetName,
    ...(await showBuildSettingsAsync({
      ...query,
      targetNames: targetNamesWithoutPlatform,
      sdk: 'iphoneos',
    })),
  };
}

async function showBuildSettingsAsync({
  xcodeprojPath,
  targetNames,
  buildConfiguration,
  sdk,
  env,
  logger,
}: BuildSettingsQuery): Promise<BuildSettingsByTargetName> {
  let stdout: string;
  try {
    ({ stdout } = await spawn(
      'xcodebuild',
      [
        '-project',
        xcodeprojPath,
        ...targetNames.flatMap(targetName => ['-target', targetName]),
        '-configuration',
        buildConfiguration,
        ...(sdk ? ['-sdk', sdk] : []),
        '-showBuildSettings',
        '-json',
      ],
      { stdio: 'pipe', env }
    ));
  } catch (err: any) {
    logger.error(err.stderr || err.stdout || err.message);
    throw new UserError(
      'NATIVE_XCODE_BUILD_SETTINGS_FAILED',
      `xcodebuild could not read the build settings of "${xcodeprojPath}" for the configuration "${buildConfiguration}". The xcodebuild output above has the reason. A common cause is a Swift package or an ".xcconfig" file that cannot be resolved on the builder.`,
      { cause: err }
    );
  }

  return Object.fromEntries(
    ShowBuildSettingsOutputZ.parse(JSON.parse(stdout)).map(({ target, buildSettings }) => [
      target,
      buildSettings,
    ])
  );
}
