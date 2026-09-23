import * as fs from 'fs-extra';
import path from 'path';

import { DefaultEnvironment } from '../../build/utils/environment';
import { EnvVar } from '../../environments/variables';
import { EnvironmentVariableVisibility } from '../../graphql/generated';

export const EAS_DETOUR_API_KEY_ENV_VAR_NAME = 'EXPO_PUBLIC_DETOUR_API_KEY';
export const EAS_DETOUR_APP_ID_ENV_VAR_NAME = 'EXPO_PUBLIC_DETOUR_APP_ID';

export const DETOUR_ENV_LABEL = 'Detour';

// Production-first, like the PostHog, Supabase and Convex integrations.
export const EAS_DETOUR_ENVIRONMENTS = [
  DefaultEnvironment.Production,
  DefaultEnvironment.Preview,
  DefaultEnvironment.Development,
];

export function detourMoveConfirmMessage(
  variableName: string,
  overlappingEnvironments: string
): string {
  return `Move ${variableName} for ${overlappingEnvironments} to this Detour app?`;
}

export function detourEnvironmentCancelMessage(knownEnvironments: string): string {
  return `Canceled. Nothing was written. Create the environment(s) first, or pass only existing ones (known: ${knownEnvironments}).`;
}

// Both ship in the app's JS bundle, so neither is Sensitive.
export function createDetourEnvVars(appID: string, apiKey: string): EnvVar[] {
  return [
    {
      name: EAS_DETOUR_APP_ID_ENV_VAR_NAME,
      value: appID,
      visibility: EnvironmentVariableVisibility.Public,
    },
    {
      name: EAS_DETOUR_API_KEY_ENV_VAR_NAME,
      value: apiKey,
      visibility: EnvironmentVariableVisibility.Public,
    },
  ];
}

export async function removeEnvLocalKeysAsync(projectDir: string): Promise<boolean> {
  const envPath = path.join(projectDir, '.env.local');
  if (!(await fs.pathExists(envPath))) {
    return false;
  }
  const names = [EAS_DETOUR_APP_ID_ENV_VAR_NAME, EAS_DETOUR_API_KEY_ENV_VAR_NAME];
  const content = await fs.readFile(envPath, 'utf8');
  const kept = content
    .split('\n')
    .filter(line => !names.some(name => line.trimStart().startsWith(`${name}=`)));
  const updated = kept.join('\n');
  if (updated === content) {
    return false;
  }
  await fs.writeFile(envPath, updated);
  return true;
}
