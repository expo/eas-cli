import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvVar, loadProjectScopedEnvVarsAsync } from '../../environments/variables';
import { EnvironmentVariableVisibility } from '../../graphql/generated';
import { confirmAsync } from '../../prompts';

export const EAS_SUPABASE_URL_ENV_VAR_NAME = 'EXPO_PUBLIC_SUPABASE_URL';
export const EAS_SUPABASE_PUBLISHABLE_KEY_ENV_VAR_NAME = 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

/** Label passed into shared env helpers for prompts and log lines. */
export const SUPABASE_ENV_LABEL = 'Supabase';

export function createSupabaseEnvVars(url: string, publishableKey: string): EnvVar[] {
  return [
    {
      name: EAS_SUPABASE_URL_ENV_VAR_NAME,
      value: url,
      visibility: EnvironmentVariableVisibility.Public,
    },
    {
      name: EAS_SUPABASE_PUBLISHABLE_KEY_ENV_VAR_NAME,
      value: publishableKey,
      visibility: EnvironmentVariableVisibility.Public,
    },
  ];
}

export async function writeEnvVarsAsync(
  envVars: EnvVar[],
  upsert: (envVar: EnvVar) => Promise<boolean>
): Promise<boolean[]> {
  const easWritten: boolean[] = [];
  for (const envVar of envVars) {
    easWritten.push(await upsert(envVar));
  }
  return easWritten;
}

export async function ensureAdditionalEnvWritesAllowedAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  environments: string[],
  nonInteractive: boolean,
  overwrite: boolean
): Promise<boolean> {
  if (overwrite) {
    return true;
  }
  const names = [EAS_SUPABASE_URL_ENV_VAR_NAME, EAS_SUPABASE_PUBLISHABLE_KEY_ENV_VAR_NAME];
  const targetSet = new Set(environments);
  for (const name of names) {
    const existingVariables = await loadProjectScopedEnvVarsAsync(graphqlClient, projectId, name);
    const hasOverlap = existingVariables.some(variable =>
      (variable.environments ?? []).some(environment => targetSet.has(environment))
    );
    if (!hasOverlap) {
      continue;
    }
    if (nonInteractive) {
      throw new Error(
        `EAS already has ${name} for ${environments.join(', ')}. Re-run with --overwrite to replace it before provisioning an additional project.`
      );
    }
    const proceed = await confirmAsync({
      message: `EAS already has ${name} covering ${environments.join(', ')}. Continue and move those values to the additional Supabase project?`,
    });
    if (!proceed) {
      throw new Error(
        `Canceled. No additional Supabase project was provisioned. Pass --overwrite to replace ${name} for ${environments.join(', ')}, or leave those environments on the primary project.`
      );
    }
    // One confirm covers both vars; stop asking. Force overwrite so the per-var upsert
    // doesn't prompt again and can't return false after we already billed the project.
    return true;
  }
  return false;
}
