import { ExpoConfig } from '@expo/config';

import ContextField, { ContextOptions } from './ContextField';
import { createGraphqlClient } from './contextUtils/createGraphqlClient';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync, isProjectIdInAppConfig } from './contextUtils/getProjectIdAsync';
import { loadServerSideEnvironmentVariablesAsync } from './contextUtils/loadServerSideEnvironmentVariablesAsync';
import {
  ExpoConfigOptions,
  getPrivateExpoConfigAsync,
  getPublicExpoConfigAsync,
} from '../../project/expoConfig';

export type DynamicConfigContextFn = (options?: ExpoConfigOptions) => Promise<{
  projectId: string;
  exp: ExpoConfig;
  projectDir: string;
}>;

export class DynamicPublicProjectConfigContextField extends ContextField<DynamicConfigContextFn> {
  async getValueAsync(options: ContextOptions): Promise<DynamicConfigContextFn> {
    return await createDynamicConfigFnAsync(getPublicExpoConfigAsync, options);
  }
}

export class DynamicPrivateProjectConfigContextField extends ContextField<DynamicConfigContextFn> {
  async getValueAsync(options: ContextOptions): Promise<DynamicConfigContextFn> {
    return await createDynamicConfigFnAsync(getPrivateExpoConfigAsync, options);
  }
}

async function createDynamicConfigFnAsync(
  getExpoConfigAsync: (projectDir: string, options?: ExpoConfigOptions) => Promise<ExpoConfig>,
  { nonInteractive, sessionManager, withServerSideEnvironment }: ContextOptions
): Promise<DynamicConfigContextFn> {
  const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
  return async (options?: ExpoConfigOptions) => {
    const expBefore = await getExpoConfigAsync(projectDir, options);
    const projectId = await getProjectIdAsync(sessionManager, expBefore, {
      nonInteractive,
      env: options?.env,
    });
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
      options = {
        ...options,
        env: {
          ...options?.env,
          ...serverSideEnvironmentVariables,
        },
      };
    } else if (isProjectIdInAppConfig(expBefore, projectId)) {
      return {
        exp: expBefore,
        projectDir,
        projectId,
      };
    }
    const exp = await getExpoConfigAsync(projectDir, options);
    return {
      exp,
      projectDir,
      projectId,
    };
  };
}
