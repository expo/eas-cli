import { Env } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvironmentVariableEnvironment } from '../graphql/generated';
import { EnvironmentVariablesQuery } from '../graphql/queries/EnvironmentVariablesQuery';
import Log from '../log';

function isEnvironment(env: string): env is EnvironmentVariableEnvironment {
  return Object.values(EnvironmentVariableEnvironment).includes(
    env.toUpperCase() as EnvironmentVariableEnvironment
  );
}

export async function evaluateConfigWithEnvVarsAsync<Config extends { projectId: string }, Opts>({
  flags,
  buildProfile,
  graphqlClient,
  getProjectConfig,
  opts,
}: {
  flags: { environment?: string };
  buildProfile: BuildProfile;
  graphqlClient: ExpoGraphqlClient | null;
  opts: Opts;
  getProjectConfig(opts: Opts): Promise<Config>;
}): Promise<Config & { env: Env }> {
  if (!graphqlClient) {
    Log.warn('An Expo user account is required to fetch environment variables.');
    const config = await getProjectConfig(opts);
    return { env: buildProfile.env ?? {}, ...config };
  }
  const { projectId } = await getProjectConfig({ env: buildProfile.env, ...opts });
  const env = await resolveEnvVarsAsync({ flags, buildProfile, graphqlClient, projectId });
  const config = await getProjectConfig({ ...opts, env });

  return { env, ...config };
}

async function resolveEnvVarsAsync({
  flags,
  buildProfile,
  graphqlClient,
  projectId,
}: {
  flags: { environment?: string };
  buildProfile: BuildProfile;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
}): Promise<Env> {
  const environment =
    flags.environment ?? buildProfile.environment ?? process.env.EAS_CURRENT_ENVIRONMENT;

  if (!environment || !isEnvironment(environment)) {
    return { ...buildProfile.env };
  }

  try {
    const environmentVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(
      graphqlClient,
      {
        appId: projectId,
        environment,
      }
    );
    const envVars = Object.fromEntries(
      environmentVariables
        .filter(({ name, value }) => name && value)
        .map(({ name, value }) => [name, value])
    ) as Record<string, string>;

    return { ...envVars, ...buildProfile.env };
  } catch (e) {
    Log.error('Failed to pull env variables for environment ${environment} from EAS servers');
    Log.error(e);
    Log.error(
      'This can possibly be a bug in EAS/EAS CLI. Report it here: https://github.com/expo/eas-cli/issues'
    );
    return { ...buildProfile.env };
  }
}
