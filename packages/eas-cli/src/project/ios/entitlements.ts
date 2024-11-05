import { ExportedConfig, IOSConfig, compileModsAsync } from '@expo/config-plugins';
import { JSONObject } from '@expo/json-file';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';
import spawnAsync from '@expo/spawn-async';

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

    let expWithMods: ExportedConfig;
    try {
      const { stdout } = await spawnAsync(
        'npx',
        ['expo', 'config', '--json', '--type', 'introspect'],

        {
          cwd: projectDir,
          env: {
            ...process.env,
            ...env,
            EXPO_NO_DOTENV: '1',
          },
        }
      );
      expWithMods = JSON.parse(stdout);
    } catch (err: any) {
      if (!wasExpoConfigPluginsWarnPrinted) {
        Log.warn(
          `Failed to read the app config from the project using "npx expo config" command: ${err.message}.`
        );
        Log.warn('Falling back to the version of "@expo/config" shipped with the EAS CLI.');
        wasExpoConfigPluginsWarnPrinted = true;
      }
      const { exp } = await getPrebuildConfigAsync(projectDir, { platforms: ['ios'] });
      expWithMods = await compileModsAsync(exp, {
        projectRoot: projectDir,
        platforms: ['ios'],
        introspect: true,
        ignoreExistingNativeFiles: await hasIgnoredIosProjectAsync(projectDir, vcsClient),
      });
    }
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
