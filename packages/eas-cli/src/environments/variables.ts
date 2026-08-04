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

// What happens to environments that already hold a value for this name but are not being written:
// drop them so one value covers everything, or leave them on their existing value.
export type EnvVarWriteMode = 'replaceOtherEnvironments' | 'keepOtherEnvironments';

function coversExactly(environments: string[], target: Set<string>): boolean {
  return environments.length === target.size && environments.every(e => target.has(e));
}

export async function getProjectEnvironmentVariableEnvironmentsAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string
): Promise<string[]> {
  try {
    const environments = await EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync(
      graphqlClient,
      projectId
    );
    return environments;
  } catch (error) {
    throw new Error('Failed to fetch available environments', { cause: error });
  }
}

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

export async function upsertEnvVarAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  envVar: EnvVar,
  environments: string[],
  nonInteractive: boolean,
  overwrite: boolean,
  {
    mode,
    moveConfirmMessage,
  }: {
    mode: EnvVarWriteMode;
    // Only reachable in keepOtherEnvironments mode, where a row keeps some environments and loses others.
    moveConfirmMessage?: (variableName: string, overlappingEnvironments: string) => string;
  }
): Promise<boolean> {
  const target = new Set(environments);
  const replacingAll = mode === 'replaceOtherEnvironments';
  const existingRows = await loadProjectScopedEnvVarsAsync(graphqlClient, projectId, envVar.name);

  // 1. Work out which rows this write touches. Replacing takes over every row; keeping only touches
  // rows that share an environment with the target.
  type CoveredRow = {
    id: string;
    value: string;
    environments: string[];
    visibility: EnvironmentVariableVisibility | null;
  };
  const coveredRows: CoveredRow[] = [];
  const rowsToShrink: { id: string; keptEnvironments: string[] }[] = [];
  const takenOverEnvironments = new Set<string>();
  for (const row of existingRows) {
    const rowEnvironments = row.environments ?? [];
    const handedOver = replacingAll
      ? rowEnvironments
      : rowEnvironments.filter(environment => target.has(environment));
    const kept = replacingAll
      ? []
      : rowEnvironments.filter(environment => !target.has(environment));
    if (!replacingAll && handedOver.length === 0) {
      continue;
    }
    handedOver.forEach(environment => takenOverEnvironments.add(environment));
    if (kept.length === 0) {
      coveredRows.push({
        id: row.id,
        value: row.value ?? '',
        environments: rowEnvironments,
        visibility: row.visibility ?? null,
      });
    } else {
      rowsToShrink.push({ id: row.id, keptEnvironments: kept });
    }
  }
  // Reuse the first fully covered row so the variable keeps its id; the rest are redundant. Typed
  // explicitly because tsconfig has no noUncheckedIndexedAccess, so index 0 looks always-present.
  const rowToReuse: CoveredRow | undefined = coveredRows[0];
  const redundantRows = coveredRows.slice(1);
  const takenOver = [...takenOverEnvironments].join(', ') || 'other environments';

  // 2. Get consent. Overwriting is always explicit — --overwrite, or a yes — and only a write that
  // changes nothing at all is exempt. Visibility counts: writing the same value as Public over a
  // Sensitive row would expose it, so that is a change like any other.
  const reusedRowIsIdentical =
    rowToReuse?.value === envVar.value &&
    rowToReuse.visibility === envVar.visibility &&
    coversExactly(rowToReuse.environments, target);
  const touchesExistingRows = coveredRows.length > 0 || rowsToShrink.length > 0;
  const changesNothing =
    reusedRowIsIdentical && redundantRows.length === 0 && rowsToShrink.length === 0;

  if (touchesExistingRows && !overwrite && !changesNothing) {
    let message: string;
    if (rowsToShrink.length > 0 && moveConfirmMessage) {
      message = moveConfirmMessage(envVar.name, takenOver);
    } else if (redundantRows.length > 0) {
      message = `EAS has multiple ${envVar.name} variables for this project (including ${takenOver}). Replace them with one value for ${environments.join(', ')}?`;
    } else {
      message = `EAS already has ${envVar.name} for ${takenOver}. Overwrite it?`;
    }
    if (nonInteractive || !(await confirmAsync({ message }))) {
      Log.warn(
        `Skipped updating EAS environment variable ${chalk.bold(envVar.name)}${
          nonInteractive ? ' (pass --overwrite to replace it)' : ''
        }.`
      );
      return false;
    }
  }

  // 3. Apply: hand environments over, drop redundant rows, then land the value.
  for (const { id, keptEnvironments } of rowsToShrink) {
    await EnvironmentVariableMutation.updateAsync(graphqlClient, {
      id,
      environments: keptEnvironments,
    });
  }
  for (const { id } of redundantRows) {
    await EnvironmentVariableMutation.deleteAsync(graphqlClient, id);
  }

  const fields = {
    name: envVar.name,
    value: envVar.value,
    environments,
    visibility: envVar.visibility,
    type: EnvironmentSecretType.String,
  };
  if (rowToReuse) {
    await EnvironmentVariableMutation.updateAsync(graphqlClient, { id: rowToReuse.id, ...fields });
  } else {
    await EnvironmentVariableMutation.createForAppAsync(graphqlClient, fields, projectId);
  }
  Log.withTick(
    `${rowToReuse ? 'Updated' : 'Created'} EAS environment variable ${chalk.bold(
      envVar.name
    )} for ${environments.join(', ')}`
  );
  return true;
}

export async function upsertEnvVarsSequentiallyAsync(
  envVars: EnvVar[],
  upsert: (envVar: EnvVar) => Promise<boolean>
): Promise<boolean[]> {
  const written: boolean[] = [];
  for (const envVar of envVars) {
    written.push(await upsert(envVar));
  }
  return written;
}
