import { IOSConfig, compileModsAsync as _compileModsAsync } from '@expo/config-plugins';
import { JSONObject } from '@expo/json-file';
import { getPrebuildConfigAsync as _getPrebuildConfigAsync } from '@expo/prebuild-config';
import path from 'path';

import Log from '../../log';
import { readPlistAsync } from '../../utils/plist';
import { Client } from '../../vcs/vcs';
import { hasIgnoredIosProjectAsync } from '../workflow';

interface Target {
  buildConfiguration?: string;
  targetName: string;
}

let wasExpoConfigPluginsWarnPrinted = false;

export async function getManagedApplicationTargetEntitlementsAsync(
  projectDir: string,
  env: Record<string, string>,
  vcsClient: Client
): Promise<JSONObject> {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;

  try {
    process.env = {
      ...process.env,
      ...env,
    };

    const projectExpoPrebuildConfigPath = path.join(
      projectDir,
      'node_modules',
      '@expo',
      'prebuild-config'
    );
    const projectExpoConfigPluginsPath = path.join(
      projectDir,
      'node_modules',
      '@expo',
      'config-plugins'
    );
    let getPrebuildConfigAsync: typeof _getPrebuildConfigAsync;
    let compileModsAsync: typeof _compileModsAsync;
    try {
      const expoPrebuildConfig = require(projectExpoPrebuildConfigPath);
      getPrebuildConfigAsync = expoPrebuildConfig.getPrebuildConfigAsync;
      const expoConfigPlugins = require(projectExpoConfigPluginsPath);
      compileModsAsync = expoConfigPlugins.compileModsAsync;
    } catch (err: any) {
      if (!wasExpoConfigPluginsWarnPrinted) {
        Log.warn(
          `Failed to read the app introspect expo config using project's versions of "@expo/prebuild-config" and "@expo/config-plugins": ${err.message}.`
        );
        Log.warn('Falling back to the versions shipped with the EAS CLI.');
        wasExpoConfigPluginsWarnPrinted = true;
      }
      getPrebuildConfigAsync = _getPrebuildConfigAsync;
      compileModsAsync = _compileModsAsync;
    }
    const { exp } = await getPrebuildConfigAsync(projectDir, { platforms: ['ios'] });
    const expWithMods = await compileModsAsync(exp, {
      projectRoot: projectDir,
      platforms: ['ios'],
      introspect: true,
      ignoreExistingNativeFiles: await hasIgnoredIosProjectAsync(projectDir, vcsClient),
    });
    return expWithMods.ios?.entitlements ?? {};
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
