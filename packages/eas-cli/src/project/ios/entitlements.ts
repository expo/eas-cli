import { IOSConfig, compileModsAsync } from '@expo/config-plugins';
import { JSONObject } from '@expo/json-file';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';

import Log from '../../log';
import { readPlistAsync } from '../../utils/plist';
import { getVcsClient } from '../../vcs';

interface Target {
  buildConfiguration?: string;
  targetName: string;
}

export async function getManagedApplicationTargetEntitlementsAsync(
  projectDir: string,
  env: Record<string, string>
): Promise<JSONObject> {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;
  try {
    process.env = {
      ...process.env,
      ...env,
    };
    const { exp } = await getPrebuildConfigAsync(projectDir, { platforms: ['ios'] });

    const expWithMods = await compileModsAsync(exp, {
      projectRoot: projectDir,
      platforms: ['ios'],
      introspect: true,
    });
    return expWithMods.ios?.entitlements || {};
  } finally {
    process.env = originalProcessEnv;
  }
}

export async function getNativeTargetEntitlementsAsync(
  projectDir: string,
  target: Target
): Promise<JSONObject | null> {
  const entitlementsPath = IOSConfig.Entitlements.getEntitlementsPath(projectDir, target);
  if (entitlementsPath) {
    const plist = await readPlistAsync(entitlementsPath);
    return plist ? (plist as unknown as JSONObject) : null;
  } else {
    return null;
  }
}

/**
 * When users have the `./ios` folder ignored through gitignore,
 * we should load the app entitlements as managed instead of native/bare workflow.
 * Without this, the user's configuration through config plugins will be ignored.
 * The gitignore check can be disabled by setting the `EAS_SYNC_NATIVE_CAPABILITIES=1` env variable.
 */
export async function getNativeTargetEntitlementsUnlessGitIgnoredAsync(
  projectDir: string,
  {
    target,
    env,
  }: {
    target: Target;
    env: Record<string, string>;
  }
): Promise<JSONObject | null> {
  // Escape hatch to force syncing native capabilities from `/ios` folder
  const useNativeCapabilities = process.env.EAS_SYNC_NATIVE_CAPABILITIES;
  if (useNativeCapabilities) {
    Log.log(
      'Syncing native ios capabilities from `./ios` folder, EAS_SYNC_NATIVE_CAPABILITIES is defined.'
    );
    return getNativeTargetEntitlementsAsync(projectDir, target);
  }

  // Load the capabilities from the prebuild config, instead of the native project when gitignored
  if (await getVcsClient().isFileIgnoredAsync('ios')) {
    return getManagedApplicationTargetEntitlementsAsync(projectDir, env);
  }

  // Load the capabilities from the `./ios` native project
  return getNativeTargetEntitlementsAsync(projectDir, target);
}
