import { ExpoConfig } from '@expo/config';
import { Updates } from '@expo/config-plugins';
import { Env, Workflow } from '@expo/eas-build-job';

import { isModernExpoUpdatesCLIWithRuntimeVersionCommandSupportedAsync } from './projectUtils';
import Log from '../log';
import {
  ExpoUpdatesCLIModuleNotFoundError,
  expoUpdatesCommandAsync,
} from '../utils/expoUpdatesCli';

export async function resolveRuntimeVersionAsync({
  exp,
  platform,
  workflow,
  projectDir,
  env,
  cwd,
}: {
  exp: ExpoConfig;
  platform: 'ios' | 'android';
  workflow: Workflow;
  projectDir: string;
  env: Env | undefined;
  cwd?: string;
}): Promise<{
  runtimeVersion: string | null;
  fingerprintSources: object[] | null;
} | null> {
  if (!(await isModernExpoUpdatesCLIWithRuntimeVersionCommandSupportedAsync(projectDir))) {
    // fall back to the previous behavior (using the @expo/config-plugins eas-cli dependency rather
    // than the versioned @expo/config-plugins dependency in the project)
    return {
      runtimeVersion: await Updates.getRuntimeVersionNullableAsync(projectDir, exp, platform),
      fingerprintSources: null,
    };
  }

  try {
    Log.debug('Using expo-updates runtimeversion:resolve CLI for runtime version resolution');

    const extraArgs = Log.isDebug ? ['--debug'] : [];

    const resolvedRuntimeVersionJSONResult = await expoUpdatesCommandAsync(
      projectDir,
      ['runtimeversion:resolve', '--platform', platform, '--workflow', workflow, ...extraArgs],
      { env, cwd }
    );
    const runtimeVersionResult = JSON.parse(resolvedRuntimeVersionJSONResult);

    Log.debug('runtimeversion:resolve output:');
    Log.debug(resolvedRuntimeVersionJSONResult);

    return {
      runtimeVersion: runtimeVersionResult.runtimeVersion ?? null,
      fingerprintSources: runtimeVersionResult.fingerprintSources ?? null,
    };
  } catch (e: any) {
    // if expo-updates is not installed, there's no need for a runtime version in the build
    if (e instanceof ExpoUpdatesCLIModuleNotFoundError) {
      return null;
    }
    throw e;
  }
}
