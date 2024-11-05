import { ExpoConfig } from '@expo/config';
import { InvalidEasJsonError } from '@expo/eas-json/build/errors';

import ContextField, { ContextOptions } from './ContextField';
import { createGraphqlClient } from './contextUtils/createGraphqlClient';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';
import { loadServerSideEnvironmentVariablesAsync } from './contextUtils/loadServerSideEnvironmentVariablesAsync';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';

export class OptionalPrivateProjectConfigContextField extends ContextField<
  | {
      projectId: string;
      exp: ExpoConfig;
      projectDir: string;
    }
  | undefined
> {
  async getValueAsync({
    nonInteractive,
    sessionManager,
    withServerSideEnvironment,
  }: ContextOptions): Promise<
    | {
        projectId: string;
        exp: ExpoConfig;
        projectDir: string;
      }
    | undefined
  > {
    let projectDir: string;
    try {
      projectDir = await findProjectDirAndVerifyProjectSetupAsync();
      if (!projectDir) {
        return undefined;
      }
    } catch (e) {
      if (e instanceof InvalidEasJsonError) {
        throw e;
      }
      return undefined;
    }

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
    const exp = await getPrivateExpoConfigAsync(projectDir, { env: serverSideEnvVars });
    return {
      exp,
      projectDir,
      projectId,
    };
  }
}
