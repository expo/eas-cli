import dotenv from 'dotenv';
import * as fs from 'fs-extra';
import path from 'path';

import { DefaultEnvironment } from '../../build/utils/environment';
import { EnvVar } from '../../environments/variables';
import { EnvironmentVariableVisibility } from '../../graphql/generated';

// Same names as the SurrealDB Expo guide, so its code samples work as written.
export const EAS_SURREAL_ENDPOINT_ENV_VAR_NAME = 'EXPO_PUBLIC_SURREAL_ENDPOINT';
export const EAS_SURREAL_NAMESPACE_ENV_VAR_NAME = 'EXPO_PUBLIC_SURREAL_NAMESPACE';
export const EAS_SURREAL_DATABASE_ENV_VAR_NAME = 'EXPO_PUBLIC_SURREAL_DATABASE';

export const SURREAL_ENV_VAR_NAMES = [
  EAS_SURREAL_ENDPOINT_ENV_VAR_NAME,
  EAS_SURREAL_NAMESPACE_ENV_VAR_NAME,
  EAS_SURREAL_DATABASE_ENV_VAR_NAME,
];

/** Label passed into shared env helpers for prompts and log lines. */
export const SURREAL_ENV_LABEL = 'SurrealDB';

// Production-first, matching the PostHog, Supabase and Convex integrations.
export const EAS_SURREAL_ENVIRONMENTS = [
  DefaultEnvironment.Production,
  DefaultEnvironment.Preview,
  DefaultEnvironment.Development,
];

export type SurrealConnectionValues = {
  endpoint: string;
  namespace: string;
  database: string;
};

export function surrealMoveConfirmMessage(
  variableName: string,
  overlappingEnvironments: string
): string {
  return `Move ${variableName} for ${overlappingEnvironments} to this SurrealDB instance?`;
}

export function surrealEnvironmentCancelMessage(knownEnvironments: string): string {
  return `Canceled. Nothing was written. Create the environment(s) first, or pass only existing ones (known: ${knownEnvironments}).`;
}

// All three ship in the app's JS bundle, so none is Sensitive. Credentials never go here: end users
// sign in with record access at runtime.
export function createSurrealEnvVars({
  endpoint,
  namespace,
  database,
}: SurrealConnectionValues): EnvVar[] {
  return [
    {
      name: EAS_SURREAL_ENDPOINT_ENV_VAR_NAME,
      value: endpoint,
      visibility: EnvironmentVariableVisibility.Public,
    },
    {
      name: EAS_SURREAL_NAMESPACE_ENV_VAR_NAME,
      value: namespace,
      visibility: EnvironmentVariableVisibility.Public,
    },
    {
      name: EAS_SURREAL_DATABASE_ENV_VAR_NAME,
      value: database,
      visibility: EnvironmentVariableVisibility.Public,
    },
  ];
}

export async function hasEnvLocalKeysAsync(projectDir: string): Promise<boolean> {
  const envPath = path.join(projectDir, '.env.local');
  if (!(await fs.pathExists(envPath))) {
    return false;
  }
  const existing = dotenv.parse(await fs.readFile(envPath, 'utf8'));
  return SURREAL_ENV_VAR_NAMES.some(name => existing[name] !== undefined);
}

export async function removeEnvLocalKeysAsync(projectDir: string): Promise<boolean> {
  const envPath = path.join(projectDir, '.env.local');
  if (!(await fs.pathExists(envPath))) {
    return false;
  }
  const content = await fs.readFile(envPath, 'utf8');
  const kept = content.split('\n').filter(line => {
    const definition = line.trimStart().replace(/^export\s+/, '');
    return !SURREAL_ENV_VAR_NAMES.some(name => new RegExp(`^${name}\\s*[=:]`).test(definition));
  });
  const updated = kept.join('\n');
  if (updated === content) {
    return false;
  }
  await fs.writeFile(envPath, updated);
  return true;
}
