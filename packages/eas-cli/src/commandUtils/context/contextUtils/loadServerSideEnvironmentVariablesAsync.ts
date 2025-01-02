import { ExpoGraphqlClient } from './createGraphqlClient';
import { EnvironmentVariableEnvironment } from '../../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';

const cachedServerSideEnvironmentVariables: Record<
  EnvironmentVariableEnvironment,
  Record<string, string> | null
> = {
  [EnvironmentVariableEnvironment.Development]: null,
  [EnvironmentVariableEnvironment.Preview]: null,
  [EnvironmentVariableEnvironment.Production]: null,
};

export async function loadServerSideEnvironmentVariablesAsync({
  environment,
  projectId,
  graphqlClient,
}: {
  environment: EnvironmentVariableEnvironment;
  projectId: string;
  graphqlClient: ExpoGraphqlClient;
}): Promise<Record<string, string>> {
  // don't load environment variables if they were already loaded while executing a command
  const cachedEnvVarsForEnvironment = cachedServerSideEnvironmentVariables[environment];
  if (cachedEnvVarsForEnvironment) {
    return cachedEnvVarsForEnvironment;
  }

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
      `Environment variables with visibility "Plain text" and "Sensitive" loaded from the "${environment.toLowerCase()}" environment on EAS: ${Object.keys(
        serverEnvVars
      ).join(', ')}.`
    );
  } else {
    Log.log(
      `No environment variables with visibility "Plain text" and "Sensitive" found for the "${environment.toLowerCase()}" environment on EAS.`
    );
  }
  Log.newLine();

  cachedServerSideEnvironmentVariables[environment] = serverEnvVars;

  return serverEnvVars;
}
