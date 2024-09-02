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

let wasExooPrebuildConfigWarnPrinted = false;
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
    let getPrebuildConfigAsync: typeof _getPrebuildConfigAsync;
    try {
      const expoPrebuildConfig = require(projectExpoPrebuildConfigPath);
      getPrebuildConfigAsync = expoPrebuildConfig.getPrebuildConfigAsync;
    } catch {
      if (!wasExooPrebuildConfigWarnPrinted) {
        Log.warn(
          `Failed to load getPrebuildConfigAsync function from ${projectExpoPrebuildConfigPath}`
        );
        Log.warn('Falling back to the version of @expo/prebuild-config shipped with the EAS CLI.');
        wasExooPrebuildConfigWarnPrinted = true;
      }
      getPrebuildConfigAsync = _getPrebuildConfigAsync;
    }
    const { exp } = await getPrebuildConfigAsync(projectDir, { platforms: ['ios'] });

    const projectExpoConfigPluginsPath = path.join(
      projectDir,
      'node_modules',
      '@expo',
      'config-plugins'
    );
    let compileModsAsync: typeof _compileModsAsync;
    try {
      const expoConfigPlugins = require(projectExpoConfigPluginsPath);
      compileModsAsync = expoConfigPlugins.compileModsAsync;
    } catch {
      if (!wasExpoConfigPluginsWarnPrinted) {
        Log.warn(`Failed to load compileModsAsync function from ${projectExpoConfigPluginsPath}`);
        Log.warn('Falling back to the version of @expo/config-plugins shipped with the EAS CLI.');
        wasExpoConfigPluginsWarnPrinted = true;
      }
      compileModsAsync = _compileModsAsync;
    }
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
