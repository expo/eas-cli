import { ExpoConfig } from '@expo/config';

import ContextField, { ContextOptions } from './ContextField';
import { createGraphqlClient } from './contextUtils/createGraphqlClient';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';
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
  async getValueAsync({
    nonInteractive,
    sessionManager,
    withServerSideEnvironment,
  }: ContextOptions): Promise<DynamicConfigContextFn> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    return async (options?: ExpoConfigOptions) => {
      const expBefore = await getPublicExpoConfigAsync(projectDir, options);
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
      }
      const exp = await getPublicExpoConfigAsync(projectDir, options);
      return {
        exp,
        projectDir,
        projectId,
      };
    };
  }
}

export class DynamicPrivateProjectConfigContextField extends ContextField<DynamicConfigContextFn> {
  async getValueAsync({
    nonInteractive,
    sessionManager,
    withServerSideEnvironment,
  }: ContextOptions): Promise<DynamicConfigContextFn> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    return async (options?: ExpoConfigOptions) => {
      const expBefore = await getPrivateExpoConfigAsync(projectDir, options);
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
      }
      const exp = await getPrivateExpoConfigAsync(projectDir, options);
      return {
        exp,
        projectDir,
        projectId,
      };
    };
  }
}
