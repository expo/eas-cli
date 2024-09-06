import { Env } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvironmentVariableEnvironment } from '../graphql/generated';
import { EnvironmentVariablesQuery } from '../graphql/queries/EnvironmentVariablesQuery';
import Log, { learnMore } from '../log';

function isEnvironment(env: string): env is EnvironmentVariableEnvironment {
  return Object.values(EnvironmentVariableEnvironment).includes(
    env as EnvironmentVariableEnvironment
  );
}

export async function evaluateConfigWithEnvVarsAsync<Config extends { projectId: string }, Opts>({
  flags,
  buildProfile,
  buildProfileName,
  graphqlClient,
  getProjectConfig,
  opts,
}: {
  flags: { environment?: string };
  buildProfile: BuildProfile;
  buildProfileName: string;
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
  const env = await resolveEnvVarsAsync({
    flags,
    buildProfile,
    buildProfileName,
    graphqlClient,
    projectId,
  });
  const config = await getProjectConfig({ ...opts, env });

  return { env, ...config };
}

async function resolveEnvVarsAsync({
  flags,
  buildProfile,
  buildProfileName,
  graphqlClient,
  projectId,
}: {
  flags: { environment?: string };
  buildProfile: BuildProfile;
  buildProfileName: string;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
}): Promise<Env> {
  const environment =
    flags.environment ??
    buildProfile.environment?.toUpperCase() ??
    process.env.EAS_CURRENT_ENVIRONMENT;

  if (!environment || !isEnvironment(environment)) {
    Log.log(
      `Loaded "env" configuration for the "${buildProfileName}" profile: ${
        buildProfile.env && Object.keys(buildProfile.env).length > 0
          ? Object.keys(buildProfile.env).join(', ')
          : 'no environment variables specified'
      }. ${learnMore('https://docs.expo.dev/build-reference/variables/')}`
    );
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
    const serverEnvVars = Object.fromEntries(
      environmentVariables
        .filter(({ name, value }) => name && value)
        .map(({ name, value }) => [name, value])
    ) as Record<string, string>;

    const envVarsWithSource: Record<string, 'build profile' | 'EAS server'> = {
      ...Object.fromEntries(Object.keys(serverEnvVars).map(key => [key, 'EAS server'])),
      ...(buildProfile.env
        ? Object.fromEntries(Object.keys(buildProfile.env).map(key => [key, 'build profile']))
        : null),
    };
    Log.log(
      `Loaded "env" configuration for the "${buildProfileName}" profile and "${environment.toLowerCase()}" environment: ${
        Object.keys(envVarsWithSource).length > 0
          ? Object.keys(envVarsWithSource)
              .map(key => `${key} (source: ${envVarsWithSource[key]})`)
              .join('\n')
          : 'no environment variables specified'
      }\n${learnMore('https://docs.expo.dev/build-reference/variables/')}`
    );

    return { ...serverEnvVars, ...buildProfile.env };
  } catch (e) {
    Log.error(`Failed to pull env variables for environment ${environment} from EAS servers`);
    Log.error(e);
    Log.error(
      'This can possibly be a bug in EAS/EAS CLI. Report it here: https://github.com/expo/eas-cli/issues'
    );
    return { ...buildProfile.env };
  }
}
