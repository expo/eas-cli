import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { confirmAsync } from '../prompts';
import { getProjectEnvironmentVariableEnvironmentsAsync } from '../utils/prompts';

export function parseEnvironmentFlag(value: string | undefined): string[] | null {
  if (value === undefined) {
    return null;
  }
  if (!value.trim()) {
    throw new Error(
      'Pass at least one EAS environment to --environment (e.g. --environment preview).'
    );
  }
  const environments = [
    ...new Set(
      value
        .split(',')
        .map(part => part.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (environments.length === 0) {
    throw new Error(
      'Pass at least one EAS environment to --environment (e.g. --environment preview).'
    );
  }
  for (const environment of environments) {
    if (environment.length < 3 || environment.length > 100 || !/^[a-z0-9_-]+$/.test(environment)) {
      throw new Error(
        `Invalid EAS environment "${environment}". Use 3–100 lowercase letters, numbers, dashes, or underscores.`
      );
    }
  }
  return environments;
}

/**
 * Resolve requested EAS environment names against what the project already uses.
 * Shared across integrations; pass integration-specific defaults and label at each callsite.
 */
export async function resolveTargetEnvironmentsAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  requested: string[],
  nonInteractive: boolean,
  { defaultEnvironments, label }: { defaultEnvironments: string[]; label: string }
): Promise<string[]> {
  let known = await getProjectEnvironmentVariableEnvironmentsAsync(graphqlClient, projectId);
  if (known.length === 0) {
    known = [...defaultEnvironments];
  }
  const knownSet = new Set(known);
  const unknown = requested.filter(environment => !knownSet.has(environment));
  if (unknown.length === 0) {
    return requested;
  }
  const defaultEnvironmentSet = new Set<string>(defaultEnvironments);
  const hasCustom = unknown.some(environment => !defaultEnvironmentSet.has(environment));
  if (nonInteractive) {
    const hint = hasCustom
      ? 'Custom environments require an Enterprise plan; pass only default environments, or upgrade.'
      : 'Re-run interactively to create them, or pass only existing environments.';
    throw new Error(
      `EAS environment(s) not found on this project: ${unknown.join(', ')}. Known: ${known.join(', ')}. ${hint}`
    );
  }
  const listed = unknown.map(environment => `"${environment}"`).join(', ');
  const isPlural = unknown.length > 1;
  const noun = isPlural ? 'environments' : 'environment';
  const verb = isPlural ? 'are' : 'is';
  const customHint = hasCustom
    ? ' Custom environments require an Enterprise plan; values will be written if your account supports them.'
    : '';
  const create = await confirmAsync({
    message: `EAS ${noun} ${listed} ${verb} not used on this project yet.${customHint} Continue provisioning?`,
  });
  if (!create) {
    throw new Error(
      `Canceled. No additional ${label} project was provisioned. Create the environment(s) first, or pass only existing ones (known: ${known.join(', ')}).`
    );
  }
  // Custom environments are created lazily when env vars are written (createForAppAsync).
  return requested;
}
