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
  buildProfile,
  buildProfileName,
  graphqlClient,
  getProjectConfig,
  opts,
}: {
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
    buildProfile,
    buildProfileName,
    graphqlClient,
    projectId,
  });
  const config = await getProjectConfig({ ...opts, env });

  return { env, ...config };
}

async function resolveEnvVarsAsync({
  buildProfile,
  buildProfileName,
  graphqlClient,
  projectId,
}: {
  buildProfile: BuildProfile;
  buildProfileName: string;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
}): Promise<Env> {
  const environment =
    buildProfile.environment?.toUpperCase() ?? process.env.EAS_CURRENT_ENVIRONMENT;

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

    if (Object.keys(serverEnvVars).length > 0) {
      Log.log(
        `Environment variables loaded from the "${environment.toLowerCase()}" environment on EAS servers: ${Object.keys(
          serverEnvVars
        ).join(', ')}.`
      );
    } else {
      Log.log(
        `No environment variables found for the "${environment.toLowerCase()}" environment on EAS servers.`
      );
    }

    const encryptedEnvVars = environmentVariables.filter(({ name, value }) => name && !value);
    if (encryptedEnvVars.length > 0) {
      Log.warn(
        `Some environment variables defined in the "${environment.toLowerCase()}" environment on EAS servers are of "encrypted" type and cannot be read outside of the EAS servers (including EAS CLI): ${encryptedEnvVars
          .map(({ name }) => name)
          .join(
            ', '
          )}. However, they will be available during the build process happening on the EAS servers. This can lead to potential configuration mismatches between the local development environment and the build environment if the encrypted environment variables are used to resolve the app config.`
      );
    }

    if (buildProfile.env && Object.keys(buildProfile.env).length > 0) {
      Log.log(
        `Environment variables loaded from the "${buildProfileName}" build profile "env" configuration: ${
          buildProfile.env && Object.keys(buildProfile.env).join(', ')
        }.`
      );
    } else {
      Log.log(
        `No environment variables specified in the "${buildProfileName}" build profile "env" configuration.`
      );
    }

    if (
      buildProfile.env &&
      Object.keys(buildProfile.env).length > 0 &&
      Object.keys(serverEnvVars).length > 0
    ) {
      const overlappingKeys = Object.keys(serverEnvVars).filter(
        key => buildProfile.env && Object.keys(buildProfile.env).includes(key)
      );
      if (overlappingKeys.length > 0) {
        Log.warn(
          `The following environment variables are defined in both the "${buildProfileName}" build profile "env" configuration and the "${environment.toLowerCase()}" environment on EAS servers: ${overlappingKeys.join(
            ', '
          )}. The values from the build profile configuration will be used.`
        );
      }
    }

    Log.newLine();

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
