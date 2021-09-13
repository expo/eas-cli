import { IOSConfig, compileModsAsync } from '@expo/config-plugins';
import { Workflow } from '@expo/eas-build-job';
import { JSONObject } from '@expo/json-file';
import plist from '@expo/plist';
import { getPrebuildConfig } from '@expo/prebuild-config';
import fs from 'fs';

function getEntitlementsJson(projectDir: string): JSONObject | null {
  try {
    const entitlementsPath = IOSConfig.Paths.getEntitlementsPath(projectDir);
    if (entitlementsPath) {
      return plist.parse(fs.readFileSync(entitlementsPath, 'utf8'));
    }
  } catch {}
  return null;
}

export async function getManagedEntitlementsJsonAsync(projectDir: string): Promise<JSONObject> {
  let { exp } = getPrebuildConfig(projectDir, { platforms: ['ios'] });

  exp = await compileModsAsync(exp, {
    projectRoot: projectDir,
    platforms: ['ios'],
    introspect: true,
  });
  return exp.ios?.entitlements || {};
}

export async function resolveEntitlementsJsonAsync(
  projectDir: string,
  workflow: Workflow
): Promise<JSONObject> {
  if (workflow === Workflow.GENERIC) {
    return getEntitlementsJson(projectDir) || {};
  } else if (workflow === Workflow.MANAGED) {
    return getManagedEntitlementsJsonAsync(projectDir);
  } else {
    throw new Error(`Unknown workflow: ${workflow}`);
  }
}
