import { IOSConfig, compileModsAsync } from '@expo/config-plugins';
import { Workflow } from '@expo/eas-build-job';
import { JSONObject } from '@expo/json-file';
import plist from '@expo/plist';
import { getPrebuildConfig } from '@expo/prebuild-config';
import fs from 'fs-extra';

export async function getManagedEntitlementsJsonAsync(
  projectDir: string,
  env: Record<string, string>,
): Promise<JSONObject> {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;
  try {
    process.env = {
      ...process.env,
      ...env,
    };
    let { exp } = getPrebuildConfig(projectDir, { platforms: ['ios'] });

    exp = await compileModsAsync(exp, {
      projectRoot: projectDir,
      platforms: ['ios'],
      introspect: true,
    });
    return exp.ios?.entitlements || {};
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
  try {
    const entitlementsPath = IOSConfig.Paths.getEntitlementsPath(projectDir);
    if (entitlementsPath) {
      const entitlementsContents = await fs.readFile(entitlementsPath, 'utf8');
      return plist.parse(entitlementsContents);
    }
  } catch {}
  return null;
}
