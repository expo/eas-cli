import { ExportedConfig, IOSConfig } from '@expo/config-plugins';
import { JSONObject } from '@expo/json-file';

import { spawnExpoCommand } from '../../utils/expoCli';
import { readPlistAsync } from '../../utils/plist';

interface Target {
  buildConfiguration?: string;
  targetName: string;
}

export async function getManagedApplicationTargetEntitlementsAsync(
  projectDir: string,
  env: Record<string, string>
): Promise<JSONObject> {
  const { stdout } = await spawnExpoCommand(
    projectDir,
    ['config', '--json', '--type', 'introspect'],
    {
      env,
    }
  );
  const expWithMods: ExportedConfig = JSON.parse(stdout);
  return expWithMods.ios?.entitlements ?? {};
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
