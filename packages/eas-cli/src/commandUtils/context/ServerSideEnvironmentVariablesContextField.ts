import ContextField, { ContextOptions } from './ContextField';
import { createGraphqlClient } from './contextUtils/createGraphqlClient';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';
import { loadServerSideEnvironmentVariablesAsync } from './contextUtils/loadServerSideEnvironmentVariablesAsync';
import { getPublicExpoConfigAsync } from '../../project/expoConfig';

type GetServerSideEnvironmentVariablesFn = (
  maybeEnv?: Record<string, string>
) => Promise<Record<string, string>>;

export class ServerSideEnvironmentVariablesContextField extends ContextField<GetServerSideEnvironmentVariablesFn> {
  async getValueAsync({
    nonInteractive,
    sessionManager,
    withServerSideEnvironment,
  }: ContextOptions): Promise<GetServerSideEnvironmentVariablesFn> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    return async (maybeEnv?: Record<string, string>) => {
      if (!withServerSideEnvironment) {
        throw new Error(
          'withServerSideEnvironment parameter is required to evaluate ServerSideEnvironmentVariablesContextField'
        );
      }
      const exp = await getPublicExpoConfigAsync(projectDir, { env: maybeEnv });
      const projectId = await getProjectIdAsync(sessionManager, exp, {
        nonInteractive,
        env: maybeEnv,
      });
      const { authenticationInfo } = await sessionManager.ensureLoggedInAsync({
        nonInteractive,
      });
      const graphqlClient = createGraphqlClient(authenticationInfo);
      const serverSideEnvironmentVariables = await loadServerSideEnvironmentVariablesAsync({
        environment: withServerSideEnvironment,
        projectId,
        graphqlClient,
      });
      return serverSideEnvironmentVariables;
    };
  }
}
