import chalk from 'chalk';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../graphql/generated';
import { EnvironmentVariableMutation } from '../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../graphql/queries/EnvironmentVariablesQuery';
import Log from '../log';
import { confirmAsync } from '../prompts';

export type EnvVar = { name: string; value: string; visibility: EnvironmentVariableVisibility };

type ProjectScopedEnvVar = Awaited<
  ReturnType<typeof EnvironmentVariablesQuery.byAppIdAsync>
>[number];

export async function loadProjectScopedEnvVarsAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  name: string
): Promise<ProjectScopedEnvVar[]> {
  return (
    await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
      appId: projectId,
      filterNames: [name],
    })
  ).filter(variable => variable.scope === EnvironmentVariableScope.Project);
}

export async function upsertEasEnvVarAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  envVar: EnvVar,
  environments: string[],
  nonInteractive: boolean,
  overwrite: boolean
): Promise<boolean> {
  const existingProjectVariables = await loadProjectScopedEnvVarsAsync(
    graphqlClient,
    projectId,
    envVar.name
  );

  if (existingProjectVariables.length === 0) {
    await EnvironmentVariableMutation.createForAppAsync(
      graphqlClient,
      {
        name: envVar.name,
        value: envVar.value,
        environments,
        visibility: envVar.visibility,
        type: EnvironmentSecretType.String,
      },
      projectId
    );
    Log.withTick(
      `Created EAS environment variable ${chalk.bold(envVar.name)} for ${environments.join(', ')}`
    );
    return true;
  }

  const [keeper, ...extras] = existingProjectVariables;
  const extraEnvironments = [...new Set(extras.flatMap(variable => variable.environments ?? []))];
  const shouldOverwrite =
    overwrite ||
    (!nonInteractive &&
      (await confirmAsync({
        message:
          extras.length > 0
            ? `EAS has multiple ${envVar.name} variables for this project (including ${extraEnvironments.join(', ') || 'other environments'}). Replace them with one value for ${environments.join(', ')}?`
            : `EAS already has an ${envVar.name} environment variable for this project. Overwrite it?`,
      })));
  if (!shouldOverwrite) {
    Log.warn(
      `Skipped updating EAS environment variable ${chalk.bold(envVar.name)}${
        nonInteractive ? ' (pass --overwrite to replace it)' : ''
      }.`
    );
    return false;
  }

  for (const extra of extras) {
    await EnvironmentVariableMutation.deleteAsync(graphqlClient, extra.id);
  }
  await EnvironmentVariableMutation.updateAsync(graphqlClient, {
    id: keeper.id,
    name: envVar.name,
    value: envVar.value,
    environments,
    visibility: envVar.visibility,
    type: EnvironmentSecretType.String,
  });
  Log.withTick(
    `Updated EAS environment variable ${chalk.bold(envVar.name)} for ${environments.join(', ')}`
  );
  return true;
}

export async function upsertEasEnvVarForEnvironmentsAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  envVar: EnvVar,
  environments: string[],
  nonInteractive: boolean,
  overwrite: boolean,
  { label }: { label: string }
): Promise<boolean> {
  const existingVariables = await loadProjectScopedEnvVarsAsync(
    graphqlClient,
    projectId,
    envVar.name
  );

  const targetSet = new Set(environments);
  const exactMatch = existingVariables.find(variable => {
    const current = variable.environments ?? [];
    return (
      current.length === targetSet.size && current.every(environment => targetSet.has(environment))
    );
  });
  if (exactMatch) {
    const shouldOverwrite =
      overwrite ||
      exactMatch.value === envVar.value ||
      (!nonInteractive &&
        (await confirmAsync({
          message: `EAS already has ${envVar.name} for ${environments.join(', ')}. Overwrite it?`,
        })));
    if (!shouldOverwrite) {
      Log.warn(`Skipped updating EAS environment variable ${chalk.bold(envVar.name)}.`);
      return false;
    }
    await EnvironmentVariableMutation.updateAsync(graphqlClient, {
      id: exactMatch.id,
      name: envVar.name,
      value: envVar.value,
      environments,
      visibility: envVar.visibility,
      type: EnvironmentSecretType.String,
    });
    Log.withTick(
      `Updated EAS environment variable ${chalk.bold(envVar.name)} for ${environments.join(', ')}`
    );
    return true;
  }

  const toDelete: { id: string; overlap: string[] }[] = [];
  const toShrink: { id: string; overlap: string[]; remaining: string[] }[] = [];
  for (const variable of existingVariables) {
    const current = variable.environments ?? [];
    const overlap = current.filter(environment => targetSet.has(environment));
    if (overlap.length === 0) {
      continue;
    }
    const remaining = current.filter(environment => !targetSet.has(environment));
    if (remaining.length === 0) {
      toDelete.push({ id: variable.id, overlap });
    } else {
      toShrink.push({ id: variable.id, overlap, remaining });
    }
  }

  if ((toDelete.length > 0 || toShrink.length > 0) && !overwrite) {
    const overlapLabel = [
      ...new Set([...toDelete, ...toShrink].flatMap(item => item.overlap)),
    ].join(', ');
    const shouldOverwrite =
      !nonInteractive &&
      (await confirmAsync({
        message: `Move ${envVar.name} for ${overlapLabel} to the additional ${label} project?`,
      }));
    if (!shouldOverwrite) {
      Log.warn(`Skipped updating EAS environment variable ${chalk.bold(envVar.name)}.`);
      return false;
    }
  }

  for (const item of toDelete) {
    await EnvironmentVariableMutation.deleteAsync(graphqlClient, item.id);
  }
  for (const item of toShrink) {
    await EnvironmentVariableMutation.updateAsync(graphqlClient, {
      id: item.id,
      environments: item.remaining,
    });
  }

  await EnvironmentVariableMutation.createForAppAsync(
    graphqlClient,
    {
      name: envVar.name,
      value: envVar.value,
      environments,
      visibility: envVar.visibility,
      type: EnvironmentSecretType.String,
    },
    projectId
  );
  Log.withTick(
    `Created EAS environment variable ${chalk.bold(envVar.name)} for ${environments.join(', ')}`
  );
  return true;
}
