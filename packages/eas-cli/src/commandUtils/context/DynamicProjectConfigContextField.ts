import { ExpoConfig } from '@expo/config';

import ContextField, { ContextOptions } from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';
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
  }: ContextOptions): Promise<DynamicConfigContextFn> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    return async (options?: ExpoConfigOptions) => {
      const expBefore = await getPublicExpoConfigAsync(projectDir, options);
      const projectId = await getProjectIdAsync(sessionManager, expBefore, {
        nonInteractive,
        env: options?.env,
      });
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
  }: ContextOptions): Promise<DynamicConfigContextFn> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    return async (options?: ExpoConfigOptions) => {
      const expBefore = await getPrivateExpoConfigAsync(projectDir, options);
      const projectId = await getProjectIdAsync(sessionManager, expBefore, {
        nonInteractive,
        env: options?.env,
      });
      const exp = await getPrivateExpoConfigAsync(projectDir, options);
      return {
        exp,
        projectDir,
        projectId,
      };
    };
  }
}
