import { ExpoGraphqlClient } from './createGraphqlClient';
import { fetchServerEnvironmentVariablesAsync } from '../../../environments/serverEnvironmentVariables';
import Log from '../../../log';

const cachedServerSideEnvironmentVariables: Record<string, Record<string, string> | undefined> = {};

export async function loadServerSideEnvironmentVariablesAsync({
  environment,
  projectId,
  graphqlClient,
}: {
  environment: string;
  projectId: string;
  graphqlClient: ExpoGraphqlClient;
}): Promise<Record<string, string>> {
  // don't load environment variables if they were already loaded while executing a command
  const cachedEnvVarsForEnvironment = cachedServerSideEnvironmentVariables[environment];
  if (cachedEnvVarsForEnvironment) {
    return cachedEnvVarsForEnvironment;
  }

  const serverEnvVars = await fetchServerEnvironmentVariablesAsync(graphqlClient, {
    appId: projectId,
    environment,
  });

  if (Object.keys(serverEnvVars).length > 0) {
    Log.log(
      `Environment variables with visibility "Plain text" and "Sensitive" loaded from the "${environment}" environment on EAS: ${Object.keys(
        serverEnvVars
      ).join(', ')}.`
    );
  } else {
    Log.log(
      `No environment variables with visibility "Plain text" and "Sensitive" found for the "${environment}" environment on EAS.`
    );
  }
  Log.newLine();

  cachedServerSideEnvironmentVariables[environment] = serverEnvVars;

  return serverEnvVars;
}
