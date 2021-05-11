import { getConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Workflow } from '@expo/eas-build-job';
import { JSONObject } from '@expo/json-file';
import plist from '@expo/plist';
import fs from 'fs';

function getEntitlementsJson(projectDir: string) {
  try {
    const entitlementsPath = IOSConfig.Paths.getEntitlementsPath(projectDir);
    if (entitlementsPath) {
      return plist.parse(fs.readFileSync(entitlementsPath, 'utf8'));
    }
  } catch {}
  return null;
}

export function getManagedEntitlementsJsonAsync(projectDir: string) {
  // TODO: Support prebuild mods
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  return (
    exp.ios?.entitlements || {
      // Always enable notifications...
      'aps-environment': 'production',
    }
  );
}

export async function resolveEntitlementsJsonAsync(
  projectDir: string,
  workflow: Workflow
): Promise<JSONObject> {
  if (workflow === Workflow.GENERIC) {
    return getEntitlementsJson(projectDir);
  } else if (workflow === Workflow.MANAGED) {
    return getManagedEntitlementsJsonAsync(projectDir);
  } else {
    throw new Error(`Unknown workflow: ${workflow}`);
  }
}
