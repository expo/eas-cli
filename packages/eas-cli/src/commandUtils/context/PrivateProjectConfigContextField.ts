import { ExpoConfig } from '@expo/config';

import ContextField, { ContextOptions } from './ContextField';
import { createGraphqlClient } from './contextUtils/createGraphqlClient';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync, isProjectIdInAppConfig } from './contextUtils/getProjectIdAsync';
import { loadServerSideEnvironmentVariablesAsync } from './contextUtils/loadServerSideEnvironmentVariablesAsync';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';

export class PrivateProjectConfigContextField extends ContextField<{
  projectId: string;
  exp: ExpoConfig;
  projectDir: string;
}> {
  async getValueAsync({
    nonInteractive,
    sessionManager,
    withServerSideEnvironment,
  }: ContextOptions): Promise<{
    projectId: string;
    exp: ExpoConfig;
    projectDir: string;
  }> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    const expBefore = await getPrivateExpoConfigAsync(projectDir);
    const projectId = await getProjectIdAsync(sessionManager, expBefore, {
      nonInteractive,
    });
    let serverSideEnvVars: Record<string, string> | undefined;
    if (withServerSideEnvironment) {
      const { authenticationInfo } = await sessionManager.ensureLoggedInAsync({
        nonInteractive,
      });
      const graphqlClient = createGraphqlClient(authenticationInfo);
      const serverSideEnvironmentVariables = await loadServerSideEnvironmentVariablesAsync({
        environment: withServerSideEnvironment,
        projectId,
        graphqlClient,
      });
      serverSideEnvVars = serverSideEnvironmentVariables;
    }
    const exp =
      withServerSideEnvironment || !isProjectIdInAppConfig(expBefore, projectId)
        ? await getPrivateExpoConfigAsync(projectDir, { env: serverSideEnvVars })
        : expBefore;

    return {
      projectId,
      exp,
      projectDir,
    };
  }
}
