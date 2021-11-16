import { IOSConfig, compileModsAsync } from '@expo/config-plugins';
import { Workflow } from '@expo/eas-build-job';
import { JSONObject } from '@expo/json-file';
import { getPrebuildConfig } from '@expo/prebuild-config';

import { readPlistAsync } from '../../../utils/plist';

export async function getManagedEntitlementsJsonAsync(
  projectDir: string,
  env: Record<string, string>
): Promise<JSONObject> {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;
  try {
    process.env = {
      ...process.env,
      ...env,
    };
    const { exp } = getPrebuildConfig(projectDir, { platforms: ['ios'] });

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

export async function resolveEntitlementsJsonAsync(
  projectDir: string,
  workflow: Workflow,
  env: Record<string, string>
): Promise<JSONObject> {
  if (workflow === Workflow.GENERIC) {
    return (await getEntitlementsJsonAsync(projectDir)) || {};
  } else if (workflow === Workflow.MANAGED) {
    return await getManagedEntitlementsJsonAsync(projectDir, env);
  } else {
    throw new Error(`Unknown workflow: ${workflow}`);
  }
}

async function getEntitlementsJsonAsync(projectDir: string): Promise<JSONObject | null> {
  const entitlementsPath = IOSConfig.Paths.getEntitlementsPath(projectDir);
  if (entitlementsPath) {
    const plist = await readPlistAsync(entitlementsPath);
    return plist ? (plist as unknown as JSONObject) : null;
  } else {
    return null;
  }
}
